const orderStatus = require('../constants/orderStatus');
const paymentStatus = require('../constants/paymentStatus');
const commissionStatus = require('../constants/commissionStatus');
const payoutStatus = require('../constants/payoutStatus');
const Commission = require('../models/commission.model');
const Dispute = require('../models/dispute.model');
const Order = require('../models/order.model');
const Product = require('../models/product.model');
const Refund = require('../models/refund.model');
const SellerPayout = require('../models/sellerPayout.model');
const SellerProfile = require('../models/sellerProfile.model');
const User = require('../models/user.model');

const dateMatch = (field, { startDate, endDate }) => {
  if (!startDate && !endDate) return {};
  const match = {};
  if (startDate) match.$gte = startDate;
  if (endDate) match.$lte = endDate;
  return { [field]: match };
};

const sum = async (model, match, field) => {
  const [result] = await model.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: `$${field}` } } },
  ]);
  return result?.total || 0;
};

const count = (model, match) => model.countDocuments(match);

const getOverview = async (filters = {}) => {
  const createdAtRange = dateMatch('createdAt', filters);
  const orderRange = dateMatch('createdAt', filters);
  const commissionRange = dateMatch('createdAt', filters);
  const payoutRange = dateMatch('createdAt', filters);
  const refundRange = dateMatch('createdAt', filters);

  const [
    totalUsers,
    activeUsers,
    suspendedUsers,
    totalSellers,
    verifiedSellers,
    totalProducts,
    activeProducts,
    pendingProducts,
    soldProducts,
    totalOrders,
    pendingOrders,
    completedOrders,
    cancelledOrders,
    grossMerchandiseValue,
    platformCommissionEarned,
    platformCommissionPending,
    totalRefundedAmount,
    pendingPayoutAmount,
    completedPayoutAmount,
    activeDisputes,
  ] = await Promise.all([
    count(User, createdAtRange),
    count(User, { status: 'ACTIVE', ...createdAtRange }),
    count(User, { status: 'SUSPENDED', ...createdAtRange }),
    count(SellerProfile, createdAtRange),
    count(SellerProfile, { verificationStatus: 'VERIFIED', ...createdAtRange }),
    count(Product, createdAtRange),
    count(Product, { status: 'ACTIVE', deletedAt: null, ...createdAtRange }),
    count(Product, { status: 'PENDING', deletedAt: null, ...createdAtRange }),
    count(Product, { status: 'SOLD', ...createdAtRange }),
    count(Order, orderRange),
    count(Order, {
      orderStatus: {
        $in: [
          orderStatus.PENDING_PAYMENT,
          orderStatus.PAID,
          orderStatus.PROCESSING,
          orderStatus.SHIPPED,
          orderStatus.DELIVERED,
        ],
      },
      ...orderRange,
    }),
    count(Order, { orderStatus: orderStatus.COMPLETED, ...orderRange }),
    count(Order, { orderStatus: orderStatus.CANCELLED, ...orderRange }),
    sum(Order, { paymentStatus: paymentStatus.PAID, ...orderRange }, 'subtotal'),
    sum(
      Commission,
      { status: commissionStatus.RECOGNIZED, ...commissionRange },
      'commissionAmount',
    ),
    sum(Commission, { status: commissionStatus.PENDING, ...commissionRange }, 'commissionAmount'),
    sum(
      Refund,
      { status: { $in: ['REQUESTED', 'PENDING', 'SUCCEEDED'] }, ...refundRange },
      'amount',
    ),
    sum(
      SellerPayout,
      {
        status: {
          $in: [
            payoutStatus.PENDING,
            payoutStatus.ELIGIBLE,
            payoutStatus.APPROVED,
            payoutStatus.PROCESSING,
          ],
        },
        ...payoutRange,
      },
      'amount',
    ),
    sum(SellerPayout, { status: payoutStatus.PAID, ...payoutRange }, 'amount'),
    count(Dispute, { status: { $in: ['OPEN', 'UNDER_REVIEW'] }, ...createdAtRange }),
  ]);

  return {
    totalUsers,
    activeUsers,
    suspendedUsers,
    totalSellers,
    verifiedSellers,
    totalProducts,
    activeProducts,
    pendingProducts,
    soldProducts,
    totalOrders,
    pendingOrders,
    completedOrders,
    cancelledOrders,
    grossMerchandiseValue,
    platformCommissionEarned,
    platformCommissionPending,
    totalRefundedAmount,
    pendingPayoutAmount,
    completedPayoutAmount,
    activeDisputes,
    definitions: {
      grossMerchandiseValue: 'Sum of paid seller-order subtotal snapshots in VND.',
      platformCommissionEarned: 'Sum of recognized commission snapshots, not gross order amount.',
      platformCommissionPending: 'Sum of pending commission snapshots.',
      totalRefundedAmount: 'Sum of refund records in requested, pending, or succeeded states.',
      pendingPayoutAmount: 'Sum of non-final seller payout records before PAID.',
      completedPayoutAmount: 'Sum of PAID seller payout records.',
    },
  };
};

module.exports = { dateMatch, getOverview, sum };
