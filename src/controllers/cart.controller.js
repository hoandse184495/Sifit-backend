const httpStatus = require('../constants/httpStatus');
const cartService = require('../services/cart.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const getCart = asyncHandler(async (req, res) => {
  const cart = await cartService.getCart(req.user);
  const response = new ApiResponse(httpStatus.OK, { cart }, 'Cart retrieved');

  res.status(response.statusCode).json(response);
});

const addItem = asyncHandler(async (req, res) => {
  const cart = await cartService.addItem(req.user, req.body.productId);
  const response = new ApiResponse(httpStatus.OK, { cart }, 'Cart item added');

  res.status(response.statusCode).json(response);
});

const removeItem = asyncHandler(async (req, res) => {
  const cart = await cartService.removeItem(req.user, req.params.productId);
  const response = new ApiResponse(httpStatus.OK, { cart }, 'Cart item removed');

  res.status(response.statusCode).json(response);
});

const clearCart = asyncHandler(async (req, res) => {
  const cart = await cartService.clearCart(req.user);
  const response = new ApiResponse(httpStatus.OK, { cart }, 'Cart cleared');

  res.status(response.statusCode).json(response);
});

module.exports = {
  addItem,
  clearCart,
  getCart,
  removeItem,
};
