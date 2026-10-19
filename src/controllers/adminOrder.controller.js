const httpStatus = require('../constants/httpStatus');
const orderService = require('../services/order.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const listOrders = asyncHandler(async (req, res) => {
  const result = await orderService.listAdminOrders(req.query);
  const response = new ApiResponse(httpStatus.OK, result, 'Orders retrieved');

  res.status(response.statusCode).json(response);
});

const getOrder = asyncHandler(async (req, res) => {
  const order = await orderService.getOrderById(req.params.id, req.user);
  const response = new ApiResponse(httpStatus.OK, { order }, 'Order retrieved');

  res.status(response.statusCode).json(response);
});

module.exports = {
  getOrder,
  listOrders,
};
