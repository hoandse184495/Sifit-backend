const httpStatus = require('../constants/httpStatus');
const checkoutService = require('../services/checkout.service');
const orderService = require('../services/order.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const createOrder = asyncHandler(async (req, res) => {
  const checkout = await checkoutService.createCheckout({
    buyer: req.user,
    shippingAddress: req.body.shippingAddress,
    notes: req.body.notes,
    idempotencyKey: req.body.idempotencyKey,
  });
  const response = new ApiResponse(httpStatus.CREATED, { checkout }, 'Checkout created');

  res.status(response.statusCode).json(response);
});

const listMyOrders = asyncHandler(async (req, res) => {
  const result = await orderService.listBuyerOrders(req.user, req.query);
  const response = new ApiResponse(httpStatus.OK, result, 'Orders retrieved');

  res.status(response.statusCode).json(response);
});

const getOrder = asyncHandler(async (req, res) => {
  const order = await orderService.getOrderById(req.params.id, req.user);
  const response = new ApiResponse(httpStatus.OK, { order }, 'Order retrieved');

  res.status(response.statusCode).json(response);
});

const cancelOrder = asyncHandler(async (req, res) => {
  const order = await orderService.cancelOrder(req.params.id, req.user);
  const response = new ApiResponse(httpStatus.OK, { order }, 'Order cancelled');

  res.status(response.statusCode).json(response);
});

module.exports = {
  cancelOrder,
  createOrder,
  getOrder,
  listMyOrders,
};
