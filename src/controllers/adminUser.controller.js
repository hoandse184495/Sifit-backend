const httpStatus = require('../constants/httpStatus');
const userService = require('../services/adminUser.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const listUsers = asyncHandler(async (req, res) => {
  const result = await userService.listUsers(req.query);
  const response = new ApiResponse(httpStatus.OK, result, 'Users retrieved');
  res.status(response.statusCode).json(response);
});

const getUser = asyncHandler(async (req, res) => {
  const user = await userService.getUser(req.params.id);
  const response = new ApiResponse(httpStatus.OK, { user }, 'User retrieved');
  res.status(response.statusCode).json(response);
});

const updateUserStatus = asyncHandler(async (req, res) => {
  const user = await userService.updateUserStatus({
    admin: req.user,
    id: req.params.id,
    status: req.body.status,
    reason: req.body.reason,
    req,
  });
  const response = new ApiResponse(httpStatus.OK, { user }, 'User status updated');
  res.status(response.statusCode).json(response);
});

module.exports = { getUser, listUsers, updateUserStatus };
