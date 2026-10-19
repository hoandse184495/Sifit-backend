const { z } = require('zod');
const httpStatus = require('../constants/httpStatus');
const reviewModerationService = require('../services/reviewModeration.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  type: z.enum(['product', 'seller']).optional(),
});

const moderationSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});

const parseQuery = (query) => {
  const parsed = listSchema.safeParse(query);
  if (!parsed.success) return { errors: parsed.error.issues };
  return { data: parsed.data };
};

const parseBody = (body) => {
  const parsed = moderationSchema.safeParse(body);
  if (!parsed.success) return { errors: parsed.error.issues };
  return { data: parsed.data };
};

const listReviews = asyncHandler(async (req, res) => {
  const parsed = parseQuery(req.query);
  if (parsed.errors) {
    return res.status(httpStatus.BAD_REQUEST).json({
      success: false,
      message: 'Invalid request data',
      errors: parsed.errors,
    });
  }

  const result = await reviewModerationService.listReviews(parsed.data);
  const response = new ApiResponse(httpStatus.OK, result, 'Reviews retrieved');

  return res.status(response.statusCode).json(response);
});

const hideReview = asyncHandler(async (req, res) => {
  const parsed = parseBody(req.body);
  if (parsed.errors) {
    return res.status(httpStatus.BAD_REQUEST).json({
      success: false,
      message: 'Invalid request data',
      errors: parsed.errors,
    });
  }

  const review = await reviewModerationService.moderate({
    id: req.params.id,
    admin: req.user,
    action: 'hide',
    reason: parsed.data.reason,
  });
  const response = new ApiResponse(httpStatus.OK, { review }, 'Review hidden');

  return res.status(response.statusCode).json(response);
});

const restoreReview = asyncHandler(async (req, res) => {
  const parsed = parseBody(req.body);
  if (parsed.errors) {
    return res.status(httpStatus.BAD_REQUEST).json({
      success: false,
      message: 'Invalid request data',
      errors: parsed.errors,
    });
  }

  const review = await reviewModerationService.moderate({
    id: req.params.id,
    admin: req.user,
    action: 'restore',
    reason: parsed.data.reason,
  });
  const response = new ApiResponse(httpStatus.OK, { review }, 'Review restored');

  return res.status(response.statusCode).json(response);
});

module.exports = { hideReview, listReviews, restoreReview };
