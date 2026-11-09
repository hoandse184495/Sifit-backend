const mongoose = require('mongoose');
const orderStatus = require('../constants/orderStatus');
const paymentStatus = require('../constants/paymentStatus');
const CheckoutGroup = require('../models/checkoutGroup.model');
const Order = require('../models/order.model');
const Payment = require('../models/payment.model');
const Receipt = require('../models/paymentTransaction.model');
const events = require('./notificationEvent.service');
const logger = require('../utils/logger');

const unpaidAttempt = (payment) =>
  ['INITIATED', 'PENDING', 'FAILED', 'EXPIRED'].includes(payment.status) &&
  !payment.metadata?.exception;

// Network checks happen outside the DB transaction. Only a terminal, unpaid PayOS
// response is safe to release; ambiguous/partial/late transfers stay reserved for review.
const checkPaymentAttempts = async (groupId) => {
  const payments = await Payment.find({ checkoutGroupId: groupId });
  const checked = new Set();
  for (const payment of payments) {
    if (!unpaidAttempt(payment)) return null;
    if (payment.provider === 'simulator') continue;
    if (payment.provider !== 'payos') return null;
    if (payment.creationLeaseUntil > new Date()) return null;
    const result = await require('./paymentProviders/paymentProvider.factory')
      .getPaymentProvider('payos')
      .queryPayment(payment);
    if (result.status === 'SUCCEEDED') {
      await require('./paymentWebhook.service').handleVerifiedEvent({
        providerName: 'payos',
        parsedEvent: result,
        payload: { source: 'reservation-expiry-query', result },
      });
      return null;
    }
    if (!['CANCELLED', 'EXPIRED', 'FAILED'].includes(result.status) || result.underpaid)
      return null;
    checked.add(String(payment._id));
  }
  return checked;
};

const expireReservations = async ({ now = new Date(), limit = 20 } = {}) => {
  const expiredGroups = await CheckoutGroup.find({
    orderStatus: orderStatus.PENDING_PAYMENT,
    paymentStatus: paymentStatus.UNPAID,
    reservationExpiresAt: { $lte: now },
    $or: [{ expiryLeaseExpiresAt: { $exists: false } }, { expiryLeaseExpiresAt: { $lte: now } }],
  })
    .sort({ expiryLeaseExpiresAt: 1, reservationExpiresAt: 1 })
    .limit(limit);

  let expiredCount = 0;
  let deferredCount = 0;
  let failedCount = 0;

  for (const group of expiredGroups) {
    const lease = await CheckoutGroup.findOneAndUpdate(
      {
        _id: group._id,
        orderStatus: orderStatus.PENDING_PAYMENT,
        paymentStatus: paymentStatus.UNPAID,
        reservationExpiresAt: { $lte: now },
        $or: [
          { expiryLeaseExpiresAt: { $exists: false } },
          { expiryLeaseExpiresAt: { $lte: now } },
        ],
      },
      {
        expiryClaimedAt: now,
        expiryLeaseExpiresAt: new Date(now.getTime() + 180 * 1000),
      },
      { new: true },
    );

    if (!lease) continue;

    let session;
    try {
      const checked = await checkPaymentAttempts(lease._id);
      if (!checked) {
        deferredCount += 1;
        continue;
      }
      session = await mongoose.startSession();
      let cancelled = false;
      await session.withTransaction(async () => {
        cancelled = false;
        // Lock the group before reading payments/items. Payment creation and a
        // successful webhook also write this group, so competing transitions retry.
        const freshGroup = await CheckoutGroup.findOneAndUpdate(
          {
            _id: lease._id,
            expiryClaimedAt: lease.expiryClaimedAt,
            expiryLeaseExpiresAt: lease.expiryLeaseExpiresAt,
            orderStatus: orderStatus.PENDING_PAYMENT,
            paymentStatus: paymentStatus.UNPAID,
            reservationExpiresAt: { $lte: now },
          },
          { $inc: { paymentVersion: 1 } },
          { new: true, session },
        );
        if (!freshGroup) return;
        // Serialize receipt updates as well: an underpaid webhook need not change
        // the group's status, but must still prevent automatic inventory release.
        await Payment.updateMany({ checkoutGroupId: lease._id }, { $inc: { __v: 1 } }, { session });
        const attempts = await Payment.find({ checkoutGroupId: lease._id }).session(session);
        if (
          attempts.some(
            (payment) =>
              !unpaidAttempt(payment) ||
              (payment.provider !== 'simulator' && !checked.has(String(payment._id))),
          )
        )
          return;
        if (await Receipt.exists({ checkoutGroupId: lease._id }).session(session)) return;
        const orders = await Order.find({
          checkoutGroupId: lease._id,
          orderStatus: orderStatus.PENDING_PAYMENT,
          paymentStatus: paymentStatus.UNPAID,
        }).session(session);

        const productIds = orders.flatMap((order) => order.items.map((item) => item.productId));

        await require('./inventoryReservation.service').release(lease._id, productIds, session);

        await Order.updateMany(
          {
            checkoutGroupId: lease._id,
            orderStatus: orderStatus.PENDING_PAYMENT,
            paymentStatus: paymentStatus.UNPAID,
          },
          {
            orderStatus: orderStatus.CANCELLED,
            cancelledAt: now,
            cancellationReason: 'reservation_expired',
          },
          { session },
        );

        await CheckoutGroup.updateOne(
          {
            _id: lease._id,
            orderStatus: orderStatus.PENDING_PAYMENT,
            paymentStatus: paymentStatus.UNPAID,
          },
          {
            orderStatus: orderStatus.CANCELLED,
            cancelledAt: now,
            cancellationReason: 'reservation_expired',
            expiryLeaseExpiresAt: now,
          },
          { session },
        );
        await Payment.updateMany(
          { checkoutGroupId: lease._id, status: { $in: ['INITIATED', 'PENDING'] } },
          { $set: { status: 'EXPIRED', failedAt: now } },
          { session },
        );
        // Cancellation and its durable notifications either commit together or not at all.
        for (const order of orders) {
          for (const recipientId of [order.buyerId, order.sellerId]) {
            const eventKey = `order:${order._id}:reservation-expired:${recipientId}`;
            await events.enqueueNotificationEvent(
              {
                eventKey,
                type: 'NOTIFICATION_CREATE',
                payload: {
                  recipientId,
                  type: 'ORDER_CANCELLED',
                  title: 'Đơn hàng hết hạn thanh toán',
                  body: 'Đơn hàng đã tự hủy vì quá hạn thanh toán. Sản phẩm đã được mở bán trở lại.',
                  resourceType: 'ORDER',
                  resourceId: order._id,
                  eventKey,
                },
              },
              { session },
            );
          }
        }
        cancelled = true;
      });
      if (cancelled) expiredCount += 1;
      else deferredCount += 1;
    } catch (error) {
      failedCount += 1;
      logger.warn(`Reservation expiry deferred for ${lease._id} (${error.name || 'Error'})`);
    } finally {
      if (session) await session.endSession();
      // Avoid starving other expired groups when PayOS is unavailable for this one.
      await CheckoutGroup.updateOne(
        {
          _id: lease._id,
          expiryClaimedAt: lease.expiryClaimedAt,
          expiryLeaseExpiresAt: lease.expiryLeaseExpiresAt,
        },
        { $set: { expiryLeaseExpiresAt: new Date(now.getTime() + 60000) } },
      );
    }
  }

  return { expiredCount, deferredCount, failedCount };
};

module.exports = {
  expireReservations,
};
