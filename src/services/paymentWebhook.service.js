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
const ApiError = require('../utils/ApiError');
const { getPaymentProvider } = require('./paymentProviders/paymentProvider.factory');
const commissionService = require('./commission.service');
const ledgerService = require('./ledger.service');
const notificationEventService = require('./notificationEvent.service');

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
      const freshPayment = await Payment.findById(payment._id).session(session);

      if (freshPayment.status === paymentAttemptStatus.SUCCEEDED) {
        return;
      }

      const checkoutGroup = await CheckoutGroup.findById(freshPayment.checkoutGroupId).session(
        session,
      );

      if (
        freshPayment.amount !== parsedEvent.amount ||
        freshPayment.currency !== parsedEvent.currency
      ) {
        freshPayment.status = paymentAttemptStatus.FAILED;
        freshPayment.failedAt = new Date();
        freshPayment.metadata = { exception: 'amount_or_currency_mismatch' };
        await freshPayment.save({ session });
        throw new ApiError(httpStatus.CONFLICT, 'Payment amount or currency mismatch');
      }

      if (
        !checkoutGroup ||
        checkoutGroup.orderStatus !== orderStatus.PENDING_PAYMENT ||
        checkoutGroup.paymentStatus !== paymentStatus.UNPAID ||
        checkoutGroup.reservationExpiresAt <= new Date()
      ) {
        freshPayment.status = paymentAttemptStatus.SUCCEEDED;
        freshPayment.paidAt = new Date();
        freshPayment.metadata = { exception: 'paid_after_checkout_ineligible' };
        await freshPayment.save({ session });
        return;
      }

      const orders = await Order.find({ checkoutGroupId: checkoutGroup._id }).session(session);
      const productIds = orders.flatMap((order) => order.items.map((item) => item.productId));

      freshPayment.status = paymentAttemptStatus.SUCCEEDED;
      freshPayment.paidAt = parsedEvent.occurredAt || new Date();
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
      await Product.updateMany(
        { _id: { $in: productIds }, status: 'RESERVED' },
        { status: 'SOLD' },
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

      await Promise.all(
        orders.map((order) =>
          notificationEventService.enqueueNotificationEvent(
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
          ),
        ),
      );
    });
  } finally {
    await session.endSession();
  }
};

const handleWebhook = async ({ providerName, payload, signature }) => {
  const provider = getPaymentProvider(providerName);

  if (!provider.verifyWebhook({ payload, signature })) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid webhook signature');
  }

  const parsedEvent = provider.parseWebhook(payload);
  const { event, duplicate } = await persistEvent({ providerName, parsedEvent, payload });

  if (duplicate && event.status === 'PROCESSED') {
    return { duplicate: true, status: 'processed' };
  }

  const payment = await Payment.findOne({
    provider: providerName,
    providerPaymentId: parsedEvent.providerPaymentId,
    merchantReference: parsedEvent.merchantReference,
  });

  if (!payment) {
    event.status = 'FAILED';
    event.errorMessage = 'Payment not found';
    await event.save();
    throw new ApiError(httpStatus.NOT_FOUND, 'Payment not found');
  }

  if (parsedEvent.eventType === 'payment.succeeded' || parsedEvent.status === 'SUCCEEDED') {
    await processSuccessfulPayment({ payment, parsedEvent, webhookEvent: event });
    event.status = 'PROCESSED';
    event.processedAt = new Date();
    await event.save();
    return { duplicate: false, status: 'processed' };
  }

  if (parsedEvent.eventType === 'payment.failed' || parsedEvent.status === 'FAILED') {
    payment.status = paymentAttemptStatus.FAILED;
    payment.failedAt = new Date();
    await payment.save();
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
};
