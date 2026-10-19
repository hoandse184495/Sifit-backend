const httpStatus = require('../constants/httpStatus');
const healthService = require('../services/health.service');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const getHealth = asyncHandler(async (req, res) => {
  const health = healthService.getHealthStatus();

  if (health.database !== 'connected') {
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Database is not connected', [
      {
        field: 'database',
        message: `MongoDB connection is ${health.database}`,
      },
    ]);
  }

  const response = new ApiResponse(httpStatus.OK, health, 'SIFIT API is running');

  res.status(response.statusCode).json({
    success: response.success,
    message: response.message,
    data: response.data,
  });
});

module.exports = {
  getHealth,
};
