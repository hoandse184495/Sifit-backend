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

const explainEligibility = async (order, now = new Date()) => {
  const reasons = [];
  if (order.paymentStatus !== paymentStatus.PAID) reasons.push('PAYMENT_NOT_VERIFIED');
  if (order.orderStatus !== orderStatus.COMPLETED) reasons.push('ORDER_NOT_COMPLETED');
  if (!order.deliveredAt) reasons.push('DELIVERY_NOT_VERIFIED');
  if (!order.protectionEndsAt || order.protectionEndsAt > now)
    reasons.push('PROTECTION_WINDOW_ACTIVE');
  const activeDispute = await Dispute.exists({
    orderId: order._id,
    status: { $in: ['OPEN', 'UNDER_REVIEW'] },
  });
  if (activeDispute) reasons.push('ACTIVE_DISPUTE');
  const sellerProfile = await SellerProfile.findOne({ userId: order.sellerId });
  if (!sellerProfile || sellerProfile.verificationStatus !== 'VERIFIED')
    reasons.push('SELLER_NOT_VERIFIED');
  const holdUntil = new Date(order.completedAt?.getTime?.() || 0);
  holdUntil.setDate(holdUntil.getDate() + env.PAYOUT_HOLD_DAYS);
  if (!order.completedAt || holdUntil > now) reasons.push('PAYOUT_HOLD_ACTIVE');
  const existingPayout = await SellerPayout.exists({
    orderIds: order._id,
    status: { $nin: [payoutStatus.CANCELLED, payoutStatus.FAILED] },
  });
  if (existingPayout) reasons.push('PAYOUT_ALREADY_EXISTS');
  return { eligible: reasons.length === 0, reasons };
};

const evaluateEligibleOrders = async ({ now = new Date(), limit = 50 } = {}) => {
  const orders = await Order.find({
    orderStatus: orderStatus.COMPLETED,
    paymentStatus: paymentStatus.PAID,
  }).limit(limit);
  let eligibleCount = 0;
  for (const order of orders) {
    const result = await explainEligibility(order, now);
    if (!result.eligible) continue;
    const commission = await Commission.findOne({ orderId: order._id });
    if (!commission) continue;
    try {
      const payout = await SellerPayout.create({
        sellerId: order.sellerId,
        orderIds: [order._id],
        amount: commission.sellerProceeds,
        status: payoutStatus.ELIGIBLE,
        provider: 'simulator',
        requestedAt: now,
        idempotencyKey: `eligible:${order._id}`,
      });
      await notificationEventService.enqueueNotificationEvent({
        eventKey: `payout:${payout._id}:eligible`,
        type: 'NOTIFICATION_CREATE',
        payload: {
          recipientId: order.sellerId,
          type: 'PAYOUT_ELIGIBLE',
          title: 'Payout eligible',
          body: 'Seller proceeds are eligible for payout',
          resourceType: 'PAYOUT',
          resourceId: payout._id,
          eventKey: `payout:${payout._id}:eligible`,
        },
      });
      eligibleCount += 1;
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  }
  return { eligibleCount };
};

module.exports = { evaluateEligibleOrders, explainEligibility };
