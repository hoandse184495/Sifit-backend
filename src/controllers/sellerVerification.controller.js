const httpStatus = require('../constants/httpStatus');
const sellerVerificationService = require('../services/sellerVerification.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const submitVerification = asyncHandler(async (req, res) => {
  const verification = await sellerVerificationService.submitVerification(req.user);
  res
    .status(201)
    .json(new ApiResponse(httpStatus.CREATED, { verification }, 'Verification submitted'));
});
const getStatus = asyncHandler(async (req, res) => {
  const verification = await sellerVerificationService.getStatus(req.user);
  res
    .status(200)
    .json(new ApiResponse(httpStatus.OK, { verification }, 'Verification status retrieved'));
});
const listPending = asyncHandler(async (req, res) => {
  const result = await sellerVerificationService.listPending(req.query);
  res.status(200).json(new ApiResponse(httpStatus.OK, result, 'Seller verifications retrieved'));
});
const approve = asyncHandler(async (req, res) => {
  const verification = await sellerVerificationService.review({
    id: req.params.id,
    admin: req.user,
    status: 'VERIFIED',
  });
  res
    .status(200)
    .json(new ApiResponse(httpStatus.OK, { verification }, 'Seller verification approved'));
});
const reject = asyncHandler(async (req, res) => {
  const verification = await sellerVerificationService.review({
    id: req.params.id,
    admin: req.user,
    status: 'REJECTED',
    reason: req.body.reason,
  });
  res
    .status(200)
    .json(new ApiResponse(httpStatus.OK, { verification }, 'Seller verification rejected'));
});

module.exports = { approve, getStatus, listPending, reject, submitVerification };
