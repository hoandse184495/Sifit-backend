const httpStatus = require('../constants/httpStatus');
const analyticsService = require('../services/adminAnalytics.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const revenue = asyncHandler(async (req, res) => {
  const data = await analyticsService.revenue(req.query);
  const response = new ApiResponse(httpStatus.OK, data, 'Revenue analytics retrieved');
  res.status(response.statusCode).json(response);
});

const orders = asyncHandler(async (req, res) => {
  const data = await analyticsService.orders(req.query);
  const response = new ApiResponse(httpStatus.OK, data, 'Order analytics retrieved');
  res.status(response.statusCode).json(response);
});

const users = asyncHandler(async (req, res) => {
  const data = await analyticsService.users(req.query);
  const response = new ApiResponse(httpStatus.OK, data, 'User analytics retrieved');
  res.status(response.statusCode).json(response);
});

const products = asyncHandler(async (req, res) => {
  const data = await analyticsService.products(req.query);
  const response = new ApiResponse(httpStatus.OK, data, 'Product analytics retrieved');
  res.status(response.statusCode).json(response);
});

const commissions = asyncHandler(async (req, res) => {
  const data = await analyticsService.commissions(req.query);
  const response = new ApiResponse(httpStatus.OK, data, 'Commission analytics retrieved');
  res.status(response.statusCode).json(response);
});

module.exports = { commissions, orders, products, revenue, users };
