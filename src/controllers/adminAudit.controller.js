const httpStatus = require('../constants/httpStatus');
const auditService = require('../services/adminAudit.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const listAuditLogs = asyncHandler(async (req, res) => {
  const result = await auditService.list(req.query);
  const response = new ApiResponse(httpStatus.OK, result, 'Audit logs retrieved');
  res.status(response.statusCode).json(response);
});

module.exports = { listAuditLogs };
