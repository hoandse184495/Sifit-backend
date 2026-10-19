const httpStatus = require('../constants/httpStatus');
const orderStatus = require('../constants/orderStatus');
const paymentStatus = require('../constants/paymentStatus');
const payoutStatus = require('../constants/payoutStatus');
const Commission = require('../models/commission.model');
const Order = require('../models/order.model');
const SellerPayout = require('../models/sellerPayout.model');
const ApiError = require('../utils/ApiError');
const notificationEventService = require('./notificationEvent.service');

const getSellerEarnings = async (seller) => {
  const [orders, commissions, payouts] = await Promise.all([
    Order.find({ sellerId: seller._id, paymentStatus: paymentStatus.PAID }),
    Commission.find({ sellerId: seller._id }),
    SellerPayout.find({ sellerId: seller._id }),
  ]);

  const totalCompletedSales = orders.reduce((sum, order) => sum + order.subtotal, 0);
  const pendingProceeds = orders
    .filter((order) => order.orderStatus !== orderStatus.COMPLETED)
    .reduce((sum, order) => sum + order.sellerProceeds, 0);
  const eligibleProceeds = orders
    .filter((order) => order.orderStatus === orderStatus.COMPLETED)
    .reduce((sum, order) => sum + order.sellerProceeds, 0);
  const paidProceeds = payouts
    .filter((payout) => payout.status === payoutStatus.PAID)
    .reduce((sum, payout) => sum + payout.amount, 0);
  const totalCommissions = commissions.reduce(
    (sum, commission) => sum + commission.commissionAmount,
    0,
  );
  const reversedAmounts = commissions
    .filter((commission) => commission.status === 'REVERSED')
    .reduce((sum, commission) => sum + commission.commissionAmount, 0);

  return {
    totalCompletedSales,
    pendingProceeds,
    eligibleProceeds,
    paidProceeds,
    totalCommissions,
    refundedOrReversedAmounts: reversedAmounts,
  };
};

const listSellerPayouts = async (seller, { page = 1, limit = 20 } = {}) => {
  const [items, total] = await Promise.all([
    SellerPayout.find({ sellerId: seller._id })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    SellerPayout.countDocuments({ sellerId: seller._id }),
  ]);

  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const getSellerPayout = async (seller, id) => {
  const payout = await SellerPayout.findOne({ _id: id, sellerId: seller._id });

  if (!payout) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Payout not found');
  }

  return payout;
};

const listAdminPayouts = async ({ page = 1, limit = 20, status } = {}) => {
  const query = {};
  if (status) query.status = status;

  const [items, total] = await Promise.all([
    SellerPayout.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    SellerPayout.countDocuments(query),
  ]);

  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const getAdminPayout = async (id) => {
  const payout = await SellerPayout.findById(id);
  if (!payout) throw new ApiError(httpStatus.NOT_FOUND, 'Payout not found');
  return payout;
};

const approvePayout = async (id) => {
  const payout = await SellerPayout.findOneAndUpdate(
    { _id: id, status: { $in: [payoutStatus.PENDING, payoutStatus.ELIGIBLE] } },
    { status: payoutStatus.APPROVED, approvedAt: new Date() },
    { new: true },
  );

  if (!payout) {
    throw new ApiError(httpStatus.CONFLICT, 'Payout is not eligible for approval');
  }

  return payout;
};

const settlementEligibilityService = require('./settlementEligibility.service');

const evaluateEligiblePayouts = async () => settlementEligibilityService.evaluateEligibleOrders();
const processApprovedPayouts = async ({ now = new Date(), limit = 50 } = {}) => {
  const payouts = await SellerPayout.find({ status: payoutStatus.APPROVED }).limit(limit);
  let processedCount = 0;
  for (const payout of payouts) {
    payout.status = payoutStatus.PAID;
    payout.processedAt = now;
    payout.completedAt = now;
    await payout.save();
    await notificationEventService.enqueueNotificationEvent({
      eventKey: `payout:${payout._id}:completed`,
      type: 'NOTIFICATION_CREATE',
      payload: {
        recipientId: payout.sellerId,
        type: 'PAYOUT_COMPLETED',
        title: 'Payout completed',
        body: 'A simulated seller payout has been completed',
        resourceType: 'PAYOUT',
        resourceId: payout._id,
        eventKey: `payout:${payout._id}:completed`,
      },
    });
    processedCount += 1;
  }
  return { processedCount };
};

module.exports = {
  approvePayout,
  evaluateEligiblePayouts,
  getAdminPayout,
  getSellerEarnings,
  getSellerPayout,
  listAdminPayouts,
  listSellerPayouts,
  processApprovedPayouts,
};
