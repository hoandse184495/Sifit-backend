const httpStatus = require('../constants/httpStatus');
const productReviewService = require('../services/productReview.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const createReview = asyncHandler(async (req, res) => {
  const review = await productReviewService.createReview(req.user, req.body);
  const response = new ApiResponse(
    httpStatus.CREATED,
    { review: productReviewService.ownReviewDetails(review) },
    'Review created',
  );

  res.status(response.statusCode).json(response);
});

const listProductReviews = asyncHandler(async (req, res) => {
  const result = await productReviewService.listProductReviews(req.params.productId, req.query);
  const response = new ApiResponse(httpStatus.OK, result, 'Product reviews retrieved');

  res.status(response.statusCode).json(response);
});

const getProductReviewSummary = asyncHandler(async (req, res) => {
  const summary = await productReviewService.getProductReviewSummary(req.params.productId);
  const response = new ApiResponse(httpStatus.OK, { summary }, 'Product review summary retrieved');

  res.status(response.statusCode).json(response);
});

const listMyReviews = asyncHandler(async (req, res) => {
  const result = await productReviewService.listMyReviews(req.user, req.query);
  const response = new ApiResponse(httpStatus.OK, result, 'My reviews retrieved');

  res.status(response.statusCode).json(response);
});

const getReview = asyncHandler(async (req, res) => {
  const review = await productReviewService.getReview(req.params.id, req.user);
  const response = new ApiResponse(httpStatus.OK, { review }, 'Review retrieved');

  res.status(response.statusCode).json(response);
});

const updateReview = asyncHandler(async (req, res) => {
  const review = await productReviewService.updateReview(req.params.id, req.user, req.body);
  const response = new ApiResponse(
    httpStatus.OK,
    { review: productReviewService.ownReviewDetails(review) },
    'Review updated',
  );

  res.status(response.statusCode).json(response);
});

const removeReview = asyncHandler(async (req, res) => {
  const review = await productReviewService.removeReview(req.params.id, req.user);
  const response = new ApiResponse(
    httpStatus.OK,
    { review: productReviewService.ownReviewDetails(review) },
    'Review removed',
  );

  res.status(response.statusCode).json(response);
});

const replyToReview = asyncHandler(async (req, res) => {
  const review = await productReviewService.replyToReview(req.params.id, req.user, req.body.text);
  const response = new ApiResponse(httpStatus.OK, { review }, 'Review reply created');

  res.status(response.statusCode).json(response);
});

const uploadImages = asyncHandler(async (req, res) => {
  const review = await productReviewService.uploadImages(req.params.id, req.user, req.files);
  const response = new ApiResponse(
    httpStatus.OK,
    { review: productReviewService.ownReviewDetails(review) },
    'Review images uploaded',
  );

  res.status(response.statusCode).json(response);
});

const deleteImage = asyncHandler(async (req, res) => {
  const review = await productReviewService.deleteImage(
    req.params.id,
    req.params.publicId,
    req.user,
  );
  const response = new ApiResponse(
    httpStatus.OK,
    { review: productReviewService.ownReviewDetails(review) },
    'Review image deleted',
  );

  res.status(response.statusCode).json(response);
});

module.exports = {
  createReview,
  deleteImage,
  getProductReviewSummary,
  getReview,
  listMyReviews,
  listProductReviews,
  removeReview,
  replyToReview,
  updateReview,
  uploadImages,
};
