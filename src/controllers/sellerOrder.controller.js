const httpStatus = require('../constants/httpStatus');
const orderService = require('../services/order.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const listSellerOrders = asyncHandler(async (req, res) => {
  const result = await orderService.listSellerOrders(req.user, req.query);
  const response = new ApiResponse(httpStatus.OK, result, 'Seller orders retrieved');

  res.status(response.statusCode).json(response);
});

const getSellerOrder = asyncHandler(async (req, res) => {
  const order = await orderService.getOrderById(req.params.id, req.user);
  const response = new ApiResponse(httpStatus.OK, { order }, 'Seller order retrieved');

  res.status(response.statusCode).json(response);
});

module.exports = {
  getSellerOrder,
  listSellerOrders,
};
