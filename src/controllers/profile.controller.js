const profileService = require('../services/profile.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const updateProfile = asyncHandler(async (req, res) => {
  const user = await profileService.updateProfile(req.user.id, req.body);
  res.json(new ApiResponse(200, { user }, 'Profile updated successfully'));
});
const uploadAvatar = asyncHandler(async (req, res) => {
  const user = await profileService.uploadAvatar(req.user.id, req.file);
  res.json(new ApiResponse(200, { user }, 'Avatar updated successfully'));
});
const deleteAvatar = asyncHandler(async (req, res) => {
  const user = await profileService.deleteAvatar(req.user.id);
  res.json(new ApiResponse(200, { user }, 'Avatar removed successfully'));
});

module.exports = { updateProfile, uploadAvatar, deleteAvatar };
