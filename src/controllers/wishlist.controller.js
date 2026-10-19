const httpStatus = require('../constants/httpStatus');
const wishlistService = require('../services/wishlist.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const getWishlist = asyncHandler(async (req, res) => {
  const wishlist = await wishlistService.getWishlist(req.user);
  const response = new ApiResponse(httpStatus.OK, { wishlist }, 'Wishlist retrieved');

  res.status(response.statusCode).json(response);
});

const addItem = asyncHandler(async (req, res) => {
  const wishlist = await wishlistService.addItem(req.user, req.body.productId);
  const response = new ApiResponse(httpStatus.CREATED, { wishlist }, 'Wishlist item added');

  res.status(response.statusCode).json(response);
});

const removeItem = asyncHandler(async (req, res) => {
  const wishlist = await wishlistService.removeItem(req.user, req.params.productId);
  const response = new ApiResponse(httpStatus.OK, { wishlist }, 'Wishlist item removed');

  res.status(response.statusCode).json(response);
});

const clearWishlist = asyncHandler(async (req, res) => {
  const wishlist = await wishlistService.clearWishlist(req.user);
  const response = new ApiResponse(httpStatus.OK, { wishlist }, 'Wishlist cleared');

  res.status(response.statusCode).json(response);
});

const checkItem = asyncHandler(async (req, res) => {
  const result = await wishlistService.checkItem(req.user, req.params.productId);
  const response = new ApiResponse(httpStatus.OK, result, 'Wishlist item status retrieved');

  res.status(response.statusCode).json(response);
});

module.exports = { addItem, checkItem, clearWishlist, getWishlist, removeItem };
