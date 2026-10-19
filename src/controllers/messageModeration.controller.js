const httpStatus = require('../constants/httpStatus');
const moderationService = require('../services/messageModeration.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const blockUser = asyncHandler(async (req, res) => {
  const block = await moderationService.blockUser(req.user, req.params.id);
  const response = new ApiResponse(httpStatus.OK, { block }, 'User blocked');

  res.status(response.statusCode).json(response);
});

const unblockUser = asyncHandler(async (req, res) => {
  const block = await moderationService.unblockUser(req.user, req.params.id);
  const response = new ApiResponse(httpStatus.OK, { block }, 'User unblocked');

  res.status(response.statusCode).json(response);
});

const reportMessage = asyncHandler(async (req, res) => {
  const report = await moderationService.reportMessage(req.user, req.params.id, req.body.reason);
  const response = new ApiResponse(httpStatus.CREATED, { report }, 'Message reported');

  res.status(response.statusCode).json(response);
});

const listReports = asyncHandler(async (req, res) => {
  const result = await moderationService.listReports(req.user, req.query);
  const response = new ApiResponse(httpStatus.OK, result, 'Message reports retrieved');

  res.status(response.statusCode).json(response);
});

const resolveReport = asyncHandler(async (req, res) => {
  const report = await moderationService.resolveReport(
    req.user,
    req.params.id,
    req.body.resolutionNote,
  );
  const response = new ApiResponse(httpStatus.OK, { report }, 'Message report resolved');

  res.status(response.statusCode).json(response);
});

module.exports = { blockUser, listReports, reportMessage, resolveReport, unblockUser };
