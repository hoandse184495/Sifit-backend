const httpStatus = require('../constants/httpStatus');
const roles = require('../constants/roles');
const Message = require('../models/message.model');
const MessageReport = require('../models/messageReport.model');
const User = require('../models/user.model');
const UserBlock = require('../models/userBlock.model');
const ApiError = require('../utils/ApiError');
const conversationService = require('./conversation.service');

const blockUser = async (user, blockedUserId) => {
  if (String(user._id) === String(blockedUserId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'You cannot block yourself');
  }
  const blockedUser = await User.exists({ _id: blockedUserId });
  if (!blockedUser) throw new ApiError(httpStatus.NOT_FOUND, 'User not found');

  return UserBlock.findOneAndUpdate(
    { blockerId: user._id, blockedId: blockedUserId },
    { active: true, blockedAt: new Date(), $unset: { unblockedAt: '' } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
};

const unblockUser = async (user, blockedUserId) =>
  UserBlock.findOneAndUpdate(
    { blockerId: user._id, blockedId: blockedUserId },
    { active: false, unblockedAt: new Date() },
    { new: true },
  );

const reportMessage = async (user, messageId, reason) => {
  const message = await Message.findById(messageId);
  if (!message) throw new ApiError(httpStatus.NOT_FOUND, 'Message not found');
  await conversationService.getParticipantIds(message.conversationId, user);
  if (message.senderId.equals(user._id)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'You cannot report your own message');
  }

  return MessageReport.findOneAndUpdate(
    { messageId: message._id, reporterId: user._id, status: 'OPEN' },
    {
      $setOnInsert: {
        messageId: message._id,
        conversationId: message.conversationId,
        reporterId: user._id,
        reportedUserId: message.senderId,
        reason,
        status: 'OPEN',
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
};

const listReports = async (admin, { page = 1, limit = 20, status }) => {
  if (admin.role !== roles.ADMIN)
    throw new ApiError(httpStatus.FORBIDDEN, 'Insufficient permissions');
  const query = {};
  if (status) query.status = status;
  const [items, total] = await Promise.all([
    MessageReport.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({ path: 'messageId' })
      .populate({ path: 'reporterId', select: 'fullName avatar status' })
      .populate({ path: 'reportedUserId', select: 'fullName avatar status' }),
    MessageReport.countDocuments(query),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const resolveReport = async (admin, id, resolutionNote) => {
  if (admin.role !== roles.ADMIN)
    throw new ApiError(httpStatus.FORBIDDEN, 'Insufficient permissions');
  const report = await MessageReport.findByIdAndUpdate(
    id,
    { status: 'RESOLVED', resolutionNote, resolvedBy: admin._id, resolvedAt: new Date() },
    { new: true },
  );
  if (!report) throw new ApiError(httpStatus.NOT_FOUND, 'Report not found');
  return report;
};

module.exports = { blockUser, listReports, reportMessage, resolveReport, unblockUser };
