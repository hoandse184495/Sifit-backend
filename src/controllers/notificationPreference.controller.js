const httpStatus = require('../constants/httpStatus');
const preferenceService = require('../services/notificationPreference.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const getPreferences = asyncHandler(async (req, res) => {
  const preferences = await preferenceService.getOrCreatePreferences(req.user);
  const response = new ApiResponse(
    httpStatus.OK,
    { preferences },
    'Notification preferences retrieved',
  );

  res.status(response.statusCode).json(response);
});

const updatePreferences = asyncHandler(async (req, res) => {
  const preferences = await preferenceService.updatePreferences(req.user, req.body);
  const response = new ApiResponse(
    httpStatus.OK,
    { preferences },
    'Notification preferences updated',
  );

  res.status(response.statusCode).json(response);
});

module.exports = { getPreferences, updatePreferences };
