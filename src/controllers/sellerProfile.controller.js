const httpStatus = require('../constants/httpStatus');
const sellerProfileService = require('../services/sellerProfile.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const createProfile = asyncHandler(async (req, res) => {
  const profile = await sellerProfileService.createProfile(req.user, req.body);
  res.status(201).json(new ApiResponse(httpStatus.CREATED, { profile }, 'Seller profile created'));
});
const getOwnProfile = asyncHandler(async (req, res) => {
  const profile = await sellerProfileService.getOwnProfile(req.user);
  res.status(200).json(new ApiResponse(httpStatus.OK, { profile }, 'Seller profile retrieved'));
});
const updateProfile = asyncHandler(async (req, res) => {
  const profile = await sellerProfileService.updateProfile(req.user, req.body);
  res.status(200).json(new ApiResponse(httpStatus.OK, { profile }, 'Seller profile updated'));
});
const getPublicShop = asyncHandler(async (req, res) => {
  const result = await sellerProfileService.getPublicShop(req.params.slug);
  res.status(200).json(new ApiResponse(httpStatus.OK, result, 'Shop retrieved'));
});
const listPublicShops = asyncHandler(async (req, res) => {
  const result = await sellerProfileService.listPublicShops(req.query);
  res.status(200).json(new ApiResponse(httpStatus.OK, result, 'Shops retrieved'));
});

module.exports = { createProfile, getOwnProfile, getPublicShop, listPublicShops, updateProfile };
