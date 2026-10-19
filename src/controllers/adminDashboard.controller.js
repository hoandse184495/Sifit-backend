const httpStatus = require('../constants/httpStatus');
const dashboardService = require('../services/adminDashboard.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const overview = asyncHandler(async (req, res) => {
  const data = await dashboardService.getOverview(req.query);
  const response = new ApiResponse(httpStatus.OK, data, 'Dashboard overview retrieved');

  res.status(response.statusCode).json(response);
});

module.exports = { overview };
