const httpStatus = require('../constants/httpStatus');
const payoutService = require('../services/payout.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const getEarnings = asyncHandler(async (req, res) => {
  const earnings = await payoutService.getSellerEarnings(req.user);
  const response = new ApiResponse(httpStatus.OK, { earnings }, 'Seller earnings retrieved');
  res.status(response.statusCode).json(response);
});

const listPayouts = asyncHandler(async (req, res) => {
  const result = await payoutService.listSellerPayouts(req.user, req.query);
  const response = new ApiResponse(httpStatus.OK, result, 'Seller payouts retrieved');
  res.status(response.statusCode).json(response);
});

const getPayout = asyncHandler(async (req, res) => {
  const payout = await payoutService.getSellerPayout(req.user, req.params.id);
  const response = new ApiResponse(httpStatus.OK, { payout }, 'Seller payout retrieved');
  res.status(response.statusCode).json(response);
});

module.exports = { getEarnings, getPayout, listPayouts };
