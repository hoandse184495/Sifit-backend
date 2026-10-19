const paymentStatus = require('../constants/paymentStatus');
const commissionStatus = require('../constants/commissionStatus');
const payoutStatus = require('../constants/payoutStatus');
const Commission = require('../models/commission.model');
const Order = require('../models/order.model');
const Product = require('../models/product.model');
const Refund = require('../models/refund.model');
const SellerPayout = require('../models/sellerPayout.model');
const SellerProfile = require('../models/sellerProfile.model');
const User = require('../models/user.model');
const { dateMatch } = require('./adminDashboard.service');

const groupFormat = {
  day: '%Y-%m-%d',
  week: '%G-W%V',
  month: '%Y-%m',
};

const bucket = (groupBy) => ({
  $dateToString: {
    format: groupFormat[groupBy] || groupFormat.day,
    date: '$createdAt',
    timezone: 'Asia/Ho_Chi_Minh',
  },
});

const aggregateSeries = async (model, { startDate, endDate, groupBy }, match, accumulators) =>
  model.aggregate([
    { $match: { ...match, ...dateMatch('createdAt', { startDate, endDate }) } },
    { $group: { _id: bucket(groupBy), ...accumulators } },
    { $sort: { _id: 1 } },
  ]);

const revenue = async (filters) => {
  const [gmv, paid, earned, pending, refunded, payouts] = await Promise.all([
    aggregateSeries(
      Order,
      filters,
      { paymentStatus: paymentStatus.PAID },
      { value: { $sum: '$subtotal' } },
    ),
    aggregateSeries(
      Order,
      filters,
      { paymentStatus: paymentStatus.PAID },
      { value: { $sum: '$buyerTotal' } },
    ),
    aggregateSeries(
      Commission,
      filters,
      { status: commissionStatus.RECOGNIZED },
      { value: { $sum: '$commissionAmount' } },
    ),
    aggregateSeries(
      Commission,
      filters,
      { status: commissionStatus.PENDING },
      { value: { $sum: '$commissionAmount' } },
    ),
    aggregateSeries(
      Refund,
      filters,
      { status: { $in: ['REQUESTED', 'PENDING', 'SUCCEEDED'] } },
      { value: { $sum: '$amount' } },
    ),
    aggregateSeries(
      SellerPayout,
      filters,
      { status: payoutStatus.PAID },
      { value: { $sum: '$amount' } },
    ),
  ]);
  return {
    timezone: 'Asia/Ho_Chi_Minh',
    gmv,
    verifiedPaidAmount: paid,
    earnedCommission: earned,
    pendingCommission: pending,
    refundedAmount: refunded,
    sellerPayoutAmount: payouts,
  };
};

const orders = async (filters) => {
  const series = await aggregateSeries(
    Order,
    filters,
    {},
    {
      created: { $sum: 1 },
      paid: { $sum: { $cond: [{ $eq: ['$paymentStatus', paymentStatus.PAID] }, 1, 0] } },
      completed: { $sum: { $cond: [{ $eq: ['$orderStatus', 'COMPLETED'] }, 1, 0] } },
      cancelled: { $sum: { $cond: [{ $eq: ['$orderStatus', 'CANCELLED'] }, 1, 0] } },
      refunded: { $sum: { $cond: [{ $eq: ['$orderStatus', 'REFUNDED'] }, 1, 0] } },
    },
  );
  return { timezone: 'Asia/Ho_Chi_Minh', series };
};

const users = async (filters) => {
  const [registrations, sellers] = await Promise.all([
    aggregateSeries(User, filters, {}, { count: { $sum: 1 } }),
    aggregateSeries(
      SellerProfile,
      filters,
      {},
      {
        newSellers: { $sum: 1 },
        activeSellers: { $sum: { $cond: [{ $eq: ['$status', 'ACTIVE'] }, 1, 0] } },
      },
    ),
  ]);
  return { timezone: 'Asia/Ho_Chi_Minh', registrations, sellers };
};

const products = async (filters) => {
  const series = await aggregateSeries(
    Product,
    filters,
    {},
    {
      newListings: { $sum: 1 },
      approvedListings: { $sum: { $cond: [{ $eq: ['$status', 'ACTIVE'] }, 1, 0] } },
      rejectedListings: { $sum: { $cond: [{ $eq: ['$status', 'REJECTED'] }, 1, 0] } },
      soldProducts: { $sum: { $cond: [{ $eq: ['$status', 'SOLD'] }, 1, 0] } },
    },
  );
  return { timezone: 'Asia/Ho_Chi_Minh', series };
};

const commissions = async (filters) => {
  const [totals, byDay, byMonth, bySeller] = await Promise.all([
    Commission.aggregate([
      { $match: dateMatch('createdAt', filters) },
      {
        $group: {
          _id: '$status',
          amount: { $sum: '$commissionAmount' },
          count: { $sum: 1 },
        },
      },
    ]),
    aggregateSeries(
      Commission,
      { ...filters, groupBy: 'day' },
      {},
      { amount: { $sum: '$commissionAmount' } },
    ),
    aggregateSeries(
      Commission,
      { ...filters, groupBy: 'month' },
      {},
      { amount: { $sum: '$commissionAmount' } },
    ),
    Commission.aggregate([
      { $match: dateMatch('createdAt', filters) },
      {
        $group: {
          _id: '$sellerId',
          commissionAmount: { $sum: '$commissionAmount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { commissionAmount: -1 } },
      { $limit: 20 },
    ]),
  ]);
  return {
    totals,
    byDay,
    byMonth,
    bySeller,
    accountingBasis: 'Commission model snapshots; historical rates are not recalculated.',
  };
};

module.exports = { commissions, orders, products, revenue, users };
