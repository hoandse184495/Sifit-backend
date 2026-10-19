const httpStatus = require('../constants/httpStatus');
const Conversation = require('../models/conversation.model');
const ConversationReadState = require('../models/conversationReadState.model');
const Message = require('../models/message.model');
const Product = require('../models/product.model');
const UserBlock = require('../models/userBlock.model');
const ApiError = require('../utils/ApiError');

const safeUser = (user) =>
  user
    ? {
        id: user.id || String(user._id),
        fullName: user.fullName,
        avatar: user.avatar,
        status: user.status,
      }
    : null;

const safeProduct = (product) =>
  product
    ? {
        id: product.id || String(product._id),
        title: product.title,
        price: product.price,
        status: product.status,
        primaryImage: product.images?.[0]?.url,
      }
    : null;

const safeMessagePreview = (message) => {
  if (!message) return null;
  return {
    id: message.id || String(message._id),
    senderId: String(message.senderId?._id || message.senderId),
    type: message.type,
    content: message.deletedAt ? null : message.content,
    createdAt: message.createdAt,
    deletedAt: message.deletedAt,
  };
};

const assertParticipant = (conversation, user) => {
  if (!conversation || !conversation.participants.some((id) => id.equals(user._id))) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Conversation not found');
  }
};

const isBlockedPair = async (userA, userB) =>
  Boolean(
    await UserBlock.exists({
      active: true,
      $or: [
        { blockerId: userA, blockedId: userB },
        { blockerId: userB, blockedId: userA },
      ],
    }),
  );

const createConversation = async (user, { productId }) => {
  const product = await Product.findOne({ _id: productId, status: 'ACTIVE', deletedAt: null });
  if (!product) throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');
  if (product.sellerId.equals(user._id)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'You cannot start a conversation with yourself');
  }
  if (user.status === 'SUSPENDED') {
    throw new ApiError(httpStatus.FORBIDDEN, 'Suspended users cannot start conversations');
  }
  if (await isBlockedPair(user._id, product.sellerId)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Conversation is blocked');
  }

  const conversation = await Conversation.findOneAndUpdate(
    { buyerId: user._id, sellerId: product.sellerId, productId: product._id },
    {
      $setOnInsert: {
        participants: [user._id, product.sellerId],
        buyerId: user._id,
        sellerId: product.sellerId,
        productId: product._id,
        status: 'ACTIVE',
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  return getConversationById(conversation._id, user);
};

const getConversationById = async (id, user) => {
  const conversation = await Conversation.findById(id)
    .populate({ path: 'participants', select: 'fullName avatar status' })
    .populate({ path: 'productId', select: 'title price status images' })
    .populate({ path: 'lastMessageId' });

  assertParticipant(conversation, user);

  return {
    id: conversation.id,
    buyerId: String(conversation.buyerId),
    sellerId: String(conversation.sellerId),
    participants: conversation.participants.map(safeUser),
    product: safeProduct(conversation.productId),
    lastMessage: safeMessagePreview(conversation.lastMessageId),
    lastMessageAt: conversation.lastMessageAt,
    status: conversation.status,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
};

const listConversations = async (user, { page = 1, limit = 20 }) => {
  const filter = { participants: user._id };
  const [conversations, total] = await Promise.all([
    Conversation.find(filter)
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({ path: 'participants', select: 'fullName avatar status' })
      .populate({ path: 'productId', select: 'title price status images' })
      .populate({ path: 'lastMessageId' }),
    Conversation.countDocuments(filter),
  ]);

  const states = await ConversationReadState.find({
    userId: user._id,
    conversationId: { $in: conversations.map((conversation) => conversation._id) },
  });
  const stateByConversation = new Map(states.map((state) => [String(state.conversationId), state]));

  const items = await Promise.all(
    conversations.map(async (conversation) => {
      const state = stateByConversation.get(String(conversation._id));
      const unreadQuery = {
        conversationId: conversation._id,
        senderId: { $ne: user._id },
        deletedAt: null,
      };
      if (state?.lastReadAt) unreadQuery.createdAt = { $gt: state.lastReadAt };

      return {
        id: conversation.id,
        buyerId: String(conversation.buyerId),
        sellerId: String(conversation.sellerId),
        participants: conversation.participants.map(safeUser),
        product: safeProduct(conversation.productId),
        lastMessage: safeMessagePreview(conversation.lastMessageId),
        lastMessageAt: conversation.lastMessageAt,
        status: conversation.status,
        unreadCount: await Message.countDocuments(unreadQuery),
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      };
    }),
  );

  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const getParticipantIds = async (id, user) => {
  const conversation = await Conversation.findById(id);
  assertParticipant(conversation, user);
  return conversation.participants;
};

module.exports = {
  assertParticipant,
  createConversation,
  getConversationById,
  getParticipantIds,
  isBlockedPair,
  listConversations,
  safeMessagePreview,
};
