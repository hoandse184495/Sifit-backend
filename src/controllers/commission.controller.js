const httpStatus = require('../constants/httpStatus');
const commissionService = require('../services/commission.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const listCommissions = asyncHandler(async (req, res) => {
  const result = await commissionService.listCommissions(req.query);
  const response = new ApiResponse(httpStatus.OK, result, 'Commissions retrieved');
  res.status(response.statusCode).json(response);
});

module.exports = { listCommissions };
