const httpStatus = require('../constants/httpStatus');
const Conversation = require('../models/conversation.model');
const ConversationReadState = require('../models/conversationReadState.model');
const Message = require('../models/message.model');
const ApiError = require('../utils/ApiError');
const conversationService = require('./conversation.service');

const getSocket = () => require('../socket');

const compareMessageOrder = (a, b) => {
  if (a.createdAt.getTime() !== b.createdAt.getTime())
    return a.createdAt.getTime() - b.createdAt.getTime();
  return String(a._id).localeCompare(String(b._id));
};

const markRead = async (conversationId, user, lastReadMessageId) => {
  const conversation = await Conversation.findById(conversationId);
  conversationService.assertParticipant(conversation, user);

  const target = await Message.findOne({ _id: lastReadMessageId, conversationId });
  if (!target) throw new ApiError(httpStatus.BAD_REQUEST, 'Message is not in this conversation');

  const current = await ConversationReadState.findOne({
    conversationId,
    userId: user._id,
  }).populate('lastReadMessageId');
  if (current?.lastReadMessageId && compareMessageOrder(current.lastReadMessageId, target) > 0) {
    return current;
  }

  const state = await ConversationReadState.findOneAndUpdate(
    { conversationId, userId: user._id },
    {
      lastReadMessageId: target._id,
      lastReadAt: target.createdAt,
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  getSocket().emitToConversation(conversationId, 'message:read', {
    conversationId: String(conversationId),
    userId: String(user._id),
    lastReadMessageId: String(target._id),
    lastReadAt: target.createdAt,
  });

  return state;
};

module.exports = { markRead };
