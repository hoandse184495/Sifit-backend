const httpStatus = require('../constants/httpStatus');
const aiStylistService = require('../services/aiStylist.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const getPrompts = asyncHandler(async (_req, res) => {
  const data = await aiStylistService.getQuickPrompts();
  const response = new ApiResponse(httpStatus.OK, data, 'AI Stylist prompts retrieved');
  res.status(response.statusCode).json(response);
});

const recommend = asyncHandler(async (req, res) => {
  const result = await aiStylistService.recommendOutfit({
    message: req.body?.message,
    history: Array.isArray(req.body?.history) ? req.body.history : [],
    preferences: req.body?.preferences || {},
  });
  const response = new ApiResponse(httpStatus.OK, result, 'AI Stylist recommendation generated');
  res.status(response.statusCode).json(response);
});

module.exports = {
  getPrompts,
  recommend,
};
