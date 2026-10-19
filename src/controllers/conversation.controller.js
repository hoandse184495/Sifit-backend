const httpStatus = require('../constants/httpStatus');
const conversationService = require('../services/conversation.service');
const readReceiptService = require('../services/readReceipt.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const createConversation = asyncHandler(async (req, res) => {
  const conversation = await conversationService.createConversation(req.user, req.body);
  const response = new ApiResponse(httpStatus.CREATED, { conversation }, 'Conversation ready');

  res.status(response.statusCode).json(response);
});

const listConversations = asyncHandler(async (req, res) => {
  const result = await conversationService.listConversations(req.user, req.query);
  const response = new ApiResponse(httpStatus.OK, result, 'Conversations retrieved');

  res.status(response.statusCode).json(response);
});

const getConversation = asyncHandler(async (req, res) => {
  const conversation = await conversationService.getConversationById(req.params.id, req.user);
  const response = new ApiResponse(httpStatus.OK, { conversation }, 'Conversation retrieved');

  res.status(response.statusCode).json(response);
});

const markRead = asyncHandler(async (req, res) => {
  const readState = await readReceiptService.markRead(
    req.params.id,
    req.user,
    req.body.lastReadMessageId,
  );
  const response = new ApiResponse(httpStatus.OK, { readState }, 'Conversation marked as read');

  res.status(response.statusCode).json(response);
});

module.exports = { createConversation, getConversation, listConversations, markRead };
