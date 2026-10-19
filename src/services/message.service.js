const env = require('../config/env');
const httpStatus = require('../constants/httpStatus');
const Conversation = require('../models/conversation.model');
const Message = require('../models/message.model');
const ApiError = require('../utils/ApiError');
const conversationService = require('./conversation.service');
const notificationService = require('./notification.service');

const getSocket = () => require('../socket');

const safeMessage = (message) => ({
  id: message.id || String(message._id),
  conversationId: String(message.conversationId),
  senderId: String(message.senderId?._id || message.senderId),
  type: message.type,
  content: message.deletedAt ? null : message.content,
  attachments: message.deletedAt ? [] : message.attachments,
  clientMessageId: message.clientMessageId,
  createdAt: message.createdAt,
  editedAt: message.editedAt,
  deletedAt: message.deletedAt,
});

const getConversationForUser = async (conversationId, user) => {
  const conversation = await Conversation.findById(conversationId);
  conversationService.assertParticipant(conversation, user);
  if (conversation.status !== 'ACTIVE') {
    throw new ApiError(httpStatus.CONFLICT, 'Conversation is not active');
  }
  return conversation;
};

const listMessages = async (conversationId, user, { limit = 20, before }) => {
  await getConversationForUser(conversationId, user);
  const query = { conversationId };

  if (before) {
    const cursor = await Message.findOne({ _id: before, conversationId });
    if (!cursor) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid cursor');
    query.$or = [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor._id } },
    ];
  }

  const items = await Message.find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1);
  const hasMore = items.length > limit;
  const pageItems = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? pageItems[pageItems.length - 1].id : null;

  return { items: pageItems.map(safeMessage), nextCursor, hasMore };
};

const sendMessage = async (conversationId, user, data) => {
  const conversation = await getConversationForUser(conversationId, user);
  const recipientId = conversation.participants.find((id) => !id.equals(user._id));
  if (await conversationService.isBlockedPair(user._id, recipientId)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Messaging is blocked');
  }

  const content = data.content?.trim();
  if (data.type === 'TEXT' && (!content || content.length > env.CHAT_MAX_MESSAGE_LENGTH)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid message content');
  }

  let message = await Message.findOne({
    conversationId: conversation._id,
    senderId: user._id,
    clientMessageId: data.clientMessageId,
  });
  let duplicate = Boolean(message);

  if (!message) {
    try {
      message = await Message.create({
        conversationId: conversation._id,
        senderId: user._id,
        type: data.type,
        content,
        attachments: data.attachments || [],
        clientMessageId: data.clientMessageId,
      });
      duplicate = false;
    } catch (error) {
      if (error.code !== 11000) throw error;
      message = await Message.findOne({
        conversationId: conversation._id,
        senderId: user._id,
        clientMessageId: data.clientMessageId,
      });
      duplicate = true;
    }
  }

  await Conversation.updateOne(
    { _id: conversation._id },
    { lastMessageId: message._id, lastMessageAt: message.createdAt },
  );

  const serialized = safeMessage(message);
  getSocket().emitToConversation(conversation._id, 'message:new', { message: serialized });
  getSocket().emitToConversation(conversation._id, 'conversation:updated', {
    conversationId: String(conversation._id),
    lastMessage: serialized,
    lastMessageAt: message.createdAt,
  });

  if (!duplicate) {
    await notificationService.createNotification({
      recipientId,
      actorId: user._id,
      type: 'NEW_MESSAGE',
      title: 'New message',
      body: `${user.fullName} sent you a message`,
      resourceType: 'CONVERSATION',
      resourceId: conversation._id,
      eventKey: `message:${message._id}`,
    });
  }

  return { message: serialized, duplicate };
};

module.exports = { listMessages, safeMessage, sendMessage };
