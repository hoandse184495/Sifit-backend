const httpStatus = require('../constants/httpStatus');
const disputeService = require('../services/dispute.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const openDispute = asyncHandler(async (req, res) => {
  const dispute = await disputeService.openDispute(req.params.id, req.user, req.body);
  res.status(201).json(new ApiResponse(httpStatus.CREATED, { dispute }, 'Dispute opened'));
});
const listMyDisputes = asyncHandler(async (req, res) => {
  const result = await disputeService.listMyDisputes(req.user, req.query);
  res.status(200).json(new ApiResponse(httpStatus.OK, result, 'Disputes retrieved'));
});
const getDispute = asyncHandler(async (req, res) => {
  const dispute = await disputeService.getDispute(req.params.id, req.user);
  res.status(200).json(new ApiResponse(httpStatus.OK, { dispute }, 'Dispute retrieved'));
});
const listAdminDisputes = asyncHandler(async (req, res) => {
  const result = await disputeService.listAdminDisputes(req.query);
  res.status(200).json(new ApiResponse(httpStatus.OK, result, 'Disputes retrieved'));
});
const reviewDispute = asyncHandler(async (req, res) => {
  const dispute = await disputeService.reviewDispute(req.params.id, req.user, req.body.note);
  res.status(200).json(new ApiResponse(httpStatus.OK, { dispute }, 'Dispute under review'));
});
const resolveDispute = asyncHandler(async (req, res) => {
  const dispute = await disputeService.resolveDispute(req.params.id, req.user, req.body);
  res.status(200).json(new ApiResponse(httpStatus.OK, { dispute }, 'Dispute resolved'));
});

module.exports = {
  getDispute,
  listAdminDisputes,
  listMyDisputes,
  openDispute,
  resolveDispute,
  reviewDispute,
};
