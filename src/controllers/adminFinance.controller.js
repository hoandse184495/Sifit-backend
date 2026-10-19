const httpStatus = require('../constants/httpStatus');
const Commission = require('../models/commission.model');
const Payment = require('../models/payment.model');
const LedgerEntry = require('../models/ledgerEntry.model');
const commissionService = require('../services/commission.service');
const payoutService = require('../services/payout.service');
const refundService = require('../services/refund.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const paginate = async (model, query, { page = 1, limit = 20 }) => {
  const [items, total] = await Promise.all([
    model
      .find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    model.countDocuments(query),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const listPayments = asyncHandler(async (req, res) => {
  const query = req.query.status ? { status: req.query.status } : {};
  if (req.query.checkoutGroupId) query.checkoutGroupId = req.query.checkoutGroupId;
  const result = await paginate(Payment, query, req.query);
  const response = new ApiResponse(httpStatus.OK, result, 'Payments retrieved');
  res.status(response.statusCode).json(response);
});

const listCommissions = asyncHandler(async (req, res) => {
  const result = await commissionService.listCommissions(req.query);
  const response = new ApiResponse(httpStatus.OK, result, 'Commissions retrieved');
  res.status(response.statusCode).json(response);
});

const listPayouts = asyncHandler(async (req, res) => {
  const result = await payoutService.listAdminPayouts(req.query);
  const response = new ApiResponse(httpStatus.OK, result, 'Payouts retrieved');
  res.status(response.statusCode).json(response);
});

const getPayout = asyncHandler(async (req, res) => {
  const payout = await payoutService.getAdminPayout(req.params.id);
  const response = new ApiResponse(httpStatus.OK, { payout }, 'Payout retrieved');
  res.status(response.statusCode).json(response);
});

const approvePayout = asyncHandler(async (req, res) => {
  const payout = await payoutService.approvePayout(req.params.id);
  const response = new ApiResponse(httpStatus.OK, { payout }, 'Payout approved');
  res.status(response.statusCode).json(response);
});

const financialSummary = asyncHandler(async (req, res) => {
  const [payments, commissions, ledgerEntries] = await Promise.all([
    Payment.aggregate([
      { $group: { _id: '$status', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Commission.aggregate([
      {
        $group: {
          _id: '$status',
          commissionAmount: { $sum: '$commissionAmount' },
          count: { $sum: 1 },
        },
      },
    ]),
    LedgerEntry.countDocuments(),
  ]);
  const response = new ApiResponse(
    httpStatus.OK,
    { payments, commissions, ledgerEntries },
    'Financial summary retrieved',
  );
  res.status(response.statusCode).json(response);
});

const requestRefund = asyncHandler(async (req, res) => {
  const refund = await refundService.requestRefund(req.body);
  const response = new ApiResponse(httpStatus.CREATED, { refund }, 'Refund requested');
  res.status(response.statusCode).json(response);
});

module.exports = {
  approvePayout,
  financialSummary,
  getPayout,
  listCommissions,
  listPayments,
  listPayouts,
  requestRefund,
};
