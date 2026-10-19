const httpStatus = require('../constants/httpStatus');
const sellerService = require('../services/adminSeller.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const listSellers = asyncHandler(async (req, res) => {
  const result = await sellerService.listSellers(req.query);
  const response = new ApiResponse(httpStatus.OK, result, 'Sellers retrieved');
  res.status(response.statusCode).json(response);
});

const getSeller = asyncHandler(async (req, res) => {
  const seller = await sellerService.getSeller(req.params.id);
  const response = new ApiResponse(httpStatus.OK, seller, 'Seller retrieved');
  res.status(response.statusCode).json(response);
});

const updateSellerStatus = asyncHandler(async (req, res) => {
  const seller = await sellerService.updateSellerStatus({
    admin: req.user,
    id: req.params.id,
    status: req.body.status,
    reason: req.body.reason,
    req,
  });
  const response = new ApiResponse(httpStatus.OK, { seller }, 'Seller status updated');
  res.status(response.statusCode).json(response);
});

module.exports = { getSeller, listSellers, updateSellerStatus };
