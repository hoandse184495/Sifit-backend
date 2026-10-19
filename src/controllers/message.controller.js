const httpStatus = require('../constants/httpStatus');
const messageService = require('../services/message.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const listMessages = asyncHandler(async (req, res) => {
  const result = await messageService.listMessages(req.params.id, req.user, req.query);
  const response = new ApiResponse(httpStatus.OK, result, 'Messages retrieved');

  res.status(response.statusCode).json(response);
});

const sendMessage = asyncHandler(async (req, res) => {
  const result = await messageService.sendMessage(req.params.id, req.user, req.body);
  const response = new ApiResponse(httpStatus.CREATED, result, 'Message sent');

  res.status(response.statusCode).json(response);
});

module.exports = { listMessages, sendMessage };
