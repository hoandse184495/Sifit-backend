const mongoose = require('mongoose');
const crypto = require('crypto');
const httpStatus = require('../constants/httpStatus');
const orderStatus = require('../constants/orderStatus');
const paymentStatus = require('../constants/paymentStatus');
const paymentAttemptStatus = require('../constants/paymentAttemptStatus');
const CheckoutGroup = require('../models/checkoutGroup.model');
const Order = require('../models/order.model');
const Payment = require('../models/payment.model');
const PaymentWebhookEvent = require('../models/paymentWebhookEvent.model');
const Product = require('../models/product.model');
const PaymentTransaction = require('../models/paymentTransaction.model');
const ApiError = require('../utils/ApiError');
const { getPaymentProvider } = require('./paymentProviders/paymentProvider.factory');
const commissionService = require('./commission.service');
const ledgerService = require('./ledger.service');
const notificationEventService = require('./notificationEvent.service');
const markException = async (payment, reason, receivedAmount, newReceipts, session) => {
  await Order.updateMany(
    { checkoutGroupId: payment.checkoutGroupId },
    { $inc: { settlementVersion: 1 } },
    { session },
  );
  payment.metadata = { ...payment.metadata, exception: reason, receivedAmount };
  payment.exceptionReviewState =
    payment.exceptionRefundReservedAmount > 0 ? 'REFUND_PENDING' : 'OPEN';
  await payment.save({ session });
  if (newReceipts)
    await notificationEventService.enqueueNotificationEvent(
      {
        eventKey: `payment:${payment._id}:review:${payment.reviewVersion}`,
        type: 'NOTIFICATION_CREATE',
        payload: {
          recipientId: payment.buyerId,
          type: 'PAYMENT_REVIEW_UPDATED',
          title: 'Thanh toán cần đối soát',
          body: 'Đã có biên nhận ngân hàng nhưng khoản tiền cần Sifit kiểm tra. Mở chi tiết để theo dõi số tiền và hướng xử lý.',
          resourceType: 'PAYMENT',
          resourceId: payment._id,
          eventKey: `payment:${payment._id}:review:${payment.reviewVersion}`,
        },
      },
      { session },
    );
};

const hashPayload = (payload) =>
  crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

const persistEvent = async ({ providerName, parsedEvent, payload }) => {
  try {
    const events = await PaymentWebhookEvent.create([
      {
        provider: providerName,
        eventId: parsedEvent.eventId,
        eventType: parsedEvent.eventType,
        providerPaymentId: parsedEvent.providerPaymentId,
        merchantReference: parsedEvent.merchantReference,
        payloadHash: hashPayload(payload),
      },
    ]);

    return { event: events[0], duplicate: false };
  } catch (error) {
    if (error.code === 11000) {
      const event = await PaymentWebhookEvent.findOne({
        provider: providerName,
        eventId: parsedEvent.eventId,
      });
      return { event, duplicate: true };
    }

    throw error;
  }
};

const processSuccessfulPayment = async ({ payment, parsedEvent, webhookEvent }) => {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const freshPayment = await Payment.findOneAndUpdate(
        { _id: payment._id },
        { $inc: { __v: 1 } },
        { new: true, session },
      );

      if (freshPayment.providerPaymentId?.startsWith('initializing_'))
        freshPayment.providerPaymentId = parsedEvent.providerPaymentId;

      let receivedAmount = parsedEvent.amount;
      let newReceipts = 0;
      if (freshPayment.provider === 'payos') {
        if (parsedEvent.currency !== 'VND') throw new ApiError(409, 'Invalid payment currency');
        const receipts = parsedEvent.receipts || [
          {
            reference: parsedEvent.eventId.split(':').slice(2).join(':'),
            amount: parsedEvent.amount,
            occurredAt: parsedEvent.occurredAt,
          },
        ];
        for (const receipt of receipts) {
          const existing = await PaymentTransaction.findOne({
            provider: 'payos',
            reference: receipt.reference,
          }).session(session);
          if (existing) {
            if (
              String(existing.paymentId) !== String(freshPayment._id) ||
              existing.amount !== receipt.amount
            )
              throw new ApiError(409, 'Bank transaction reference conflicts with existing receipt');
            continue;
          }
          const [record] = await PaymentTransaction.create(
            [
              {
                provider: 'payos',
                reference: receipt.reference,
                paymentId: freshPayment._id,
                checkoutGroupId: freshPayment.checkoutGroupId,
                providerPaymentId: parsedEvent.providerPaymentId,
                merchantReference: parsedEvent.merchantReference,
                amount: receipt.amount,
                currency: 'VND',
                occurredAt: receipt.occurredAt,
                status: 'MATCHED',
                source: parsedEvent.receipts ? 'RECONCILIATION' : 'WEBHOOK',
              },
            ],
            { session },
          );
          await ledgerService.postEntry(
            {
              sourceType: 'PAYMENT_TRANSACTION',
              sourceId: record.id,
              sourceEventKey: `receipt:${record.id}`,
              description: 'Verified incoming PayOS bank transfer',
              lines: [
                { account: 'provider_clearing', debit: receipt.amount, credit: 0, currency: 'VND' },
                {
                  account: 'customer_funds_unallocated',
                  debit: 0,
                  credit: receipt.amount,
                  currency: 'VND',
                },
              ],
            },
            session,
          );
          newReceipts += 1;
        }
        const records = await PaymentTransaction.find({
          paymentId: freshPayment._id,
          status: 'MATCHED',
        }).session(session);
        receivedAmount = records.reduce((sum, record) => sum + record.amount, 0);
        if (newReceipts) freshPayment.reviewVersion = (freshPayment.reviewVersion || 0) + 1;
      }
      if (
        [
          paymentAttemptStatus.SUCCEEDED,
          'PARTIALLY_REFUNDED',
          'REFUND_PENDING',
          'REFUNDED',
        ].includes(freshPayment.status)
      ) {
        if (freshPayment.provider === 'payos' && newReceipts) {
          const allocated = await require('../models/ledgerEntry.model')
            .exists({ sourceEventKey: `payment:${freshPayment._id}:allocated` })
            .session(session);
          await markException(
            freshPayment,
            allocated ? 'additional_payment_after_success' : 'paid_after_checkout_ineligible',
            receivedAmount,
            newReceipts,
            session,
          );
        }
        return;
      }

      if (
        freshPayment.provider === 'payos' &&
        (freshPayment.exceptionRefundOnly ||
          freshPayment.exceptionRefundReservedAmount > 0 ||
          freshPayment.exceptionRefundedAmount > 0)
      ) {
        await markException(
          freshPayment,
          freshPayment.exceptionRefundReservedAmount > 0
            ? 'receipt_refund_pending'
            : 'paid_after_checkout_ineligible',
          receivedAmount,
          newReceipts,
          session,
        );
        return;
      }

      const checkoutGroup = await CheckoutGroup.findById(freshPayment.checkoutGroupId).session(
        session,
      );

      if (
        freshPayment.amount !== receivedAmount ||
        freshPayment.currency !== parsedEvent.currency
      ) {
        await markException(
          freshPayment,
          'amount_or_currency_mismatch',
          receivedAmount,
          newReceipts,
          session,
        );
        return;
      }

      if (
        !checkoutGroup ||
        checkoutGroup.orderStatus !== orderStatus.PENDING_PAYMENT ||
        checkoutGroup.paymentStatus !== paymentStatus.UNPAID ||
        checkoutGroup.reservationExpiresAt <= new Date()
      ) {
        freshPayment.status = paymentAttemptStatus.SUCCEEDED;
        freshPayment.paidAt = new Date();
        await markException(
          freshPayment,
          'paid_after_checkout_ineligible',
          receivedAmount,
          newReceipts,
          session,
        );
        return;
      }

      const orders = await Order.find({ checkoutGroupId: checkoutGroup._id }).session(session);
      const productIds = orders.flatMap((order) => order.items.map((item) => item.productId));
      if (freshPayment.provider === 'payos') {
        try {
          await require('./inventoryReservation.service').assertAvailable(
            checkoutGroup._id,
            orders,
            session,
          );
        } catch (error) {
          if (error.statusCode !== 409) throw error;
          await markException(
            freshPayment,
            'inventory_requires_review',
            receivedAmount,
            newReceipts,
            session,
          );
          return;
        }
      }

      freshPayment.status = paymentAttemptStatus.SUCCEEDED;
      freshPayment.paidAt = parsedEvent.occurredAt || new Date();
      freshPayment.metadata = { ...freshPayment.metadata };
      delete freshPayment.metadata.exception;
      delete freshPayment.metadata.receivedAmount;
      freshPayment.markModified('metadata');
      if (freshPayment.exceptionReviewState !== 'NONE')
        freshPayment.exceptionReviewState = 'RESOLVED';
      await freshPayment.save({ session });

      await CheckoutGroup.updateOne(
        {
          _id: checkoutGroup._id,
          orderStatus: orderStatus.PENDING_PAYMENT,
          paymentStatus: paymentStatus.UNPAID,
        },
        { orderStatus: orderStatus.PAID, paymentStatus: paymentStatus.PAID },
        { session },
      );
      await Order.updateMany(
        {
          checkoutGroupId: checkoutGroup._id,
          orderStatus: orderStatus.PENDING_PAYMENT,
          paymentStatus: paymentStatus.UNPAID,
        },
        { orderStatus: orderStatus.PAID, paymentStatus: paymentStatus.PAID },
        { session },
      );
      if (freshPayment.provider === 'payos')
        await require('./inventoryReservation.service').acquireForPayment(
          checkoutGroup._id,
          orders,
          session,
        );
      else
        await Product.updateMany(
          { _id: { $in: productIds }, status: 'RESERVED' },
          { $set: { status: 'SOLD' }, $unset: { reservationGroupId: 1 } },
          { session },
        );

      await commissionService.createPendingForOrders(orders, session);
      await ledgerService.postPaymentSuccess(
        { payment: freshPayment, orders, eventId: webhookEvent.eventId },
        session,
      );

      await notificationEventService.enqueueNotificationEvent(
        {
          eventKey: `payment:${freshPayment._id}:confirmed:buyer`,
          type: 'NOTIFICATION_CREATE',
          payload: {
            recipientId: checkoutGroup.buyerId,
            type: 'PAYMENT_CONFIRMED',
            title: 'Payment confirmed',
            body: 'Your payment has been verified',
            resourceType: 'PAYMENT',
            resourceId: freshPayment._id,
            eventKey: `payment:${freshPayment._id}:confirmed`,
          },
        },
        { session },
      );

      for (const order of orders)
        await notificationEventService.enqueueNotificationEvent(
          {
            eventKey: `payment:${freshPayment._id}:confirmed:seller:${order.sellerId}`,
            type: 'NOTIFICATION_CREATE',
            payload: {
              recipientId: order.sellerId,
              type: 'PAYMENT_CONFIRMED',
              title: 'Order payment verified',
              body: 'A buyer payment for your order has been verified',
              resourceType: 'ORDER',
              resourceId: order._id,
              eventKey: `order:${order._id}:payment-confirmed`,
            },
          },
          { session },
        );
    });
  } finally {
    await session.endSession();
  }
};

const handleWebhook = async ({ providerName, payload, signature }) => {
  const provider = getPaymentProvider(providerName);

  if (!(await provider.verifyWebhook({ payload, signature }))) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid webhook signature');
  }

  const parsedEvent = provider.parseWebhook(payload);
  return handleVerifiedEvent({ providerName, parsedEvent, payload });
};

const handleVerifiedEvent = async ({ providerName, parsedEvent, payload }) => {
  const { event, duplicate } = await persistEvent({ providerName, parsedEvent, payload });

  if (duplicate && event.status === 'PROCESSED') {
    return { duplicate: true, status: 'processed' };
  }

  const payment = await Payment.findOne({
    provider: providerName,
    merchantReference: parsedEvent.merchantReference,
    providerPaymentId: {
      $in: [parsedEvent.providerPaymentId, `initializing_${parsedEvent.merchantReference}`],
    },
  });

  if (!payment) {
    if (providerName === 'payos') {
      event.status = 'IGNORED';
      event.errorMessage = 'No matching local payment (including PayOS registration probes)';
      await event.save();
      return { duplicate: false, status: 'ignored' };
    }
    event.status = 'FAILED';
    event.errorMessage = 'Payment not found';
    await event.save();
    throw new ApiError(httpStatus.NOT_FOUND, 'Payment not found');
  }

  if (parsedEvent.eventType === 'payment.succeeded' || parsedEvent.status === 'SUCCEEDED') {
    await processSuccessfulPayment({ payment, parsedEvent, webhookEvent: event });
    if (
      providerName === 'simulator' &&
      (await Payment.findById(payment._id)).metadata?.exception === 'amount_or_currency_mismatch'
    )
      throw new ApiError(409, 'Payment amount or currency mismatch');
    event.status = 'PROCESSED';
    event.processedAt = new Date();
    await event.save();
    const orderIds = await Order.find({ checkoutGroupId: payment.checkoutGroupId }).distinct('_id');
    await require('../utils/flushNotifications')([payment._id, ...orderIds]);
    return { duplicate: false, status: 'processed' };
  }

  if (parsedEvent.eventType === 'payment.failed' || parsedEvent.status === 'FAILED') {
    await Payment.updateOne(
      { _id: payment._id, status: { $in: ['INITIATED', 'PENDING'] } },
      { $set: { status: paymentAttemptStatus.FAILED, failedAt: new Date() } },
    );
    event.status = 'PROCESSED';
    event.processedAt = new Date();
    await event.save();
    return { duplicate: false, status: 'processed' };
  }

  event.status = 'IGNORED';
  event.processedAt = new Date();
  await event.save();
  return { duplicate: false, status: 'ignored' };
};

module.exports = {
  handleWebhook,
  handleVerifiedEvent,
};
