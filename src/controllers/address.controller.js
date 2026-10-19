const httpStatus = require('../constants/httpStatus');
const addressService = require('../services/address.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const listAddresses = asyncHandler(async (req, res) => {
  const addresses = await addressService.listAddresses(req.user);
  res.status(200).json(new ApiResponse(httpStatus.OK, { addresses }, 'Addresses retrieved'));
});
const createAddress = asyncHandler(async (req, res) => {
  const address = await addressService.createAddress(req.user, req.body);
  res.status(201).json(new ApiResponse(httpStatus.CREATED, { address }, 'Address created'));
});
const updateAddress = asyncHandler(async (req, res) => {
  const address = await addressService.updateAddress(req.user, req.params.id, req.body);
  res.status(200).json(new ApiResponse(httpStatus.OK, { address }, 'Address updated'));
});
const deleteAddress = asyncHandler(async (req, res) => {
  const address = await addressService.deleteAddress(req.user, req.params.id);
  res.status(200).json(new ApiResponse(httpStatus.OK, { address }, 'Address deleted'));
});
const setDefaultAddress = asyncHandler(async (req, res) => {
  const address = await addressService.setDefaultAddress(req.user, req.params.id);
  res.status(200).json(new ApiResponse(httpStatus.OK, { address }, 'Default address updated'));
});

module.exports = { createAddress, deleteAddress, listAddresses, setDefaultAddress, updateAddress };
