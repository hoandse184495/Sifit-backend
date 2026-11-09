const env = require('../config/env');
const orderStatus = require('../constants/orderStatus');
const paymentStatus = require('../constants/paymentStatus');
const payoutStatus = require('../constants/payoutStatus');
const Commission = require('../models/commission.model');
const Dispute = require('../models/dispute.model');
const Order = require('../models/order.model');
const SellerPayout = require('../models/sellerPayout.model');
const SellerProfile = require('../models/sellerProfile.model');
const notificationEventService = require('./notificationEvent.service');
const WorkerCursor = require('../models/workerCursor.model');

const explainEligibility = async (order, now = new Date(), session = null) => {
  const reasons = [];
  if (order.paymentStatus !== paymentStatus.PAID) reasons.push('PAYMENT_NOT_VERIFIED');
  if (order.orderStatus !== orderStatus.COMPLETED) reasons.push('ORDER_NOT_COMPLETED');
  if (!order.completedBy) reasons.push('ADMIN_COMPLETION_REQUIRED');
  if (!order.deliveredAt) reasons.push('DELIVERY_NOT_VERIFIED');
  if (!order.protectionEndsAt || order.protectionEndsAt > now)
    reasons.push('PROTECTION_WINDOW_ACTIVE');
  const activeDispute = await Dispute.exists({
    orderId: order._id,
    $or: [
      { status: { $in: ['OPEN', 'UNDER_REVIEW'] } },
      { status: 'RESOLVED_BUYER', refundSettledAt: null },
    ],
  }).session(session);
  if (activeDispute) reasons.push('ACTIVE_DISPUTE');
  const sellerProfile = await SellerProfile.findOne({ userId: order.sellerId }).session(session);
  if (
    !sellerProfile ||
    sellerProfile.verificationStatus !== 'VERIFIED' ||
    sellerProfile.status !== 'ACTIVE'
  )
    reasons.push('SELLER_NOT_VERIFIED');
  if (env.PAYOUT_MODE !== 'simulation' && !reasons.includes('SELLER_NOT_VERIFIED')) {
    try {
      await require('./sellerVerificationPolicy.service').assertVerified(order.sellerId, session);
    } catch (error) {
      if (error.statusCode !== 409) throw error;
      reasons.push('SELLER_NOT_VERIFIED');
    }
  }
  const holdUntil = new Date(order.completedAt?.getTime?.() || 0);
  holdUntil.setDate(holdUntil.getDate() + env.PAYOUT_HOLD_DAYS);
  if (!order.completedAt || holdUntil > now) reasons.push('PAYOUT_HOLD_ACTIVE');
  const existingPayout = await SellerPayout.exists({
    orderIds: order._id,
    status: { $nin: [payoutStatus.CANCELLED, payoutStatus.FAILED] },
  }).session(session);
  if (existingPayout) reasons.push('PAYOUT_ALREADY_EXISTS');
  if (await require('./refundPolicy.service').hasRefundHold(order, session))
    reasons.push('PAYMENT_REQUIRES_REVIEW');
  return { eligible: reasons.length === 0, reasons };
};

const evaluateEligibleOrders = async ({ now = new Date(), limit = 50 } = {}) => {
  const filter = {
    orderStatus: orderStatus.COMPLETED,
    paymentStatus: paymentStatus.PAID,
  };
  const cursor = await WorkerCursor.findById('payout-eligibility').lean();
  // Each pass has a fixed end so old ineligible orders are revisited even as new orders arrive.
  const untilId =
    cursor?.untilId || (await Order.findOne(filter).sort({ _id: -1 }).select('_id'))?._id;
  if (!untilId) return { eligibleCount: 0 };
  const orders = await Order.find({
    ...filter,
    _id: { $lte: untilId, ...(cursor?.afterId ? { $gt: cursor.afterId } : {}) },
  })
    .sort({ _id: 1 })
    .limit(limit);
  let eligibleCount = 0;
  for (const order of orders) {
    try {
      const payout = await require('../utils/withTransaction')(async (session) => {
        const lockedOrder = await Order.findOneAndUpdate(
          { _id: order._id, orderStatus: 'COMPLETED', paymentStatus: 'PAID' },
          { $inc: { settlementVersion: 1 } },
          { new: true, session },
        );
        if (!lockedOrder || !(await explainEligibility(lockedOrder, now, session)).eligible)
          return null;
        const commission = await Commission.findOne({
          orderId: order._id,
          status: { $ne: 'REVERSED' },
        }).session(session);
        if (!commission) return null;
        const [created] = await SellerPayout.create(
          [
            {
              sellerId: order.sellerId,
              orderIds: [order._id],
              amount: commission.sellerProceeds,
              status: payoutStatus.ELIGIBLE,
              provider: env.PAYOUT_MODE === 'simulation' ? 'simulator' : 'manual',
              requestedAt: now,
              idempotencyKey: `eligible:${order._id}`,
            },
          ],
          { session },
        );
        await notificationEventService.enqueueNotificationEvent(
          {
            eventKey: `payout:${created._id}:eligible`,
            type: 'NOTIFICATION_CREATE',
            payload: {
              recipientId: order.sellerId,
              type: 'PAYOUT_ELIGIBLE',
              title: 'Payout eligible',
              body: 'Seller proceeds are eligible for payout',
              resourceType: 'PAYOUT',
              resourceId: created._id,
              eventKey: `payout:${created._id}:eligible`,
            },
          },
          { session },
        );
        return created;
      });
      if (!payout) continue;
      eligibleCount += 1;
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  }
  const lastId = orders.at(-1)?._id;
  const completePass = orders.length < limit || String(lastId) === String(untilId);
  try {
    // A slower concurrent run must not rewind a cursor already advanced by another process.
    await WorkerCursor.updateOne(
      {
        _id: 'payout-eligibility',
        afterId: cursor?.afterId || null,
        untilId: cursor?.untilId || null,
        revision: cursor?.revision || 0,
      },
      {
        $set: { afterId: completePass ? null : lastId, untilId: completePass ? null : untilId },
        $inc: { revision: 1 },
      },
      { upsert: true },
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  return { eligibleCount };
};

module.exports = { evaluateEligibleOrders, explainEligibility };
