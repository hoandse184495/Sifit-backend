const httpStatus = require('../constants/httpStatus');
const sellerRatingService = require('../services/sellerRating.service');
const sellerReputationService = require('../services/sellerReputation.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const createSellerRating = asyncHandler(async (req, res) => {
  const rating = await sellerRatingService.createSellerRating(req.user, req.body);
  const response = new ApiResponse(httpStatus.CREATED, { rating }, 'Seller rating created');

  res.status(response.statusCode).json(response);
});

const listShopRatings = asyncHandler(async (req, res) => {
  const result = await sellerRatingService.listShopRatings(req.params.slug, req.query);
  const response = new ApiResponse(httpStatus.OK, result, 'Shop ratings retrieved');

  res.status(response.statusCode).json(response);
});

const listReceivedRatings = asyncHandler(async (req, res) => {
  const result = await sellerRatingService.listReceivedRatings(req.user, req.query);
  const response = new ApiResponse(httpStatus.OK, result, 'Seller ratings retrieved');

  res.status(response.statusCode).json(response);
});

const getMySellerRatingSummary = asyncHandler(async (req, res) => {
  const summary = await sellerRatingService.getSummary(req.user);
  const response = new ApiResponse(httpStatus.OK, { summary }, 'Seller rating summary retrieved');

  res.status(response.statusCode).json(response);
});

const getShopRatingSummary = asyncHandler(async (req, res) => {
  const summary = await sellerReputationService.getShopRatingSummary(req.params.slug);
  const response = new ApiResponse(httpStatus.OK, { summary }, 'Shop rating summary retrieved');

  res.status(response.statusCode).json(response);
});

module.exports = {
  createSellerRating,
  getMySellerRatingSummary,
  getShopRatingSummary,
  listReceivedRatings,
  listShopRatings,
};
