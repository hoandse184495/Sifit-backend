const httpStatus = require('../constants/httpStatus');
const Notification = require('../models/notification.model');
const ApiError = require('../utils/ApiError');
const preferenceService = require('./notificationPreference.service');

const getSocket = () => require('../socket');

const preferenceByType = {
  NEW_MESSAGE: 'messageNotifications',
  PRODUCT_SUBMITTED: 'productNotifications',
  PRODUCT_APPROVED: 'productNotifications',
  PRODUCT_REJECTED: 'productNotifications',
  ORDER_CREATED: 'orderNotifications',
  ORDER_CANCELLED: 'orderNotifications',
  SHIPMENT_CREATED: 'shippingNotifications',
  SHIPMENT_PICKED_UP: 'shippingNotifications',
  SHIPMENT_DELIVERED: 'shippingNotifications',
  DELIVERY_CONFIRMED: 'shippingNotifications',
  NEW_PRODUCT_REVIEW: 'reviewNotifications',
  NEW_SELLER_RATING: 'reviewNotifications',
  PAYOUT_ELIGIBLE: 'payoutNotifications',
  PAYOUT_COMPLETED: 'payoutNotifications',
};

const criticalTypes = new Set(['PAYMENT_CONFIRMED', 'DISPUTE_OPENED', 'DISPUTE_RESOLVED']);

const shouldCreateNotification = async (recipientId, type) => {
  if (criticalTypes.has(type)) return true;
  const preferences = await preferenceService.getOrCreatePreferences({ _id: recipientId });
  const preferenceField = preferenceByType[type];
  return preferences.inAppEnabled && (!preferenceField || preferences[preferenceField]);
};

const unreadCount = (user) =>
  Notification.countDocuments({ recipientId: user._id, isRead: false, deletedAt: null });

const listNotifications = async (user, { page = 1, limit = 20, isRead }) => {
  const query = { recipientId: user._id, deletedAt: null };
  if (isRead !== undefined) query.isRead = isRead;
  const [items, total] = await Promise.all([
    Notification.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Notification.countDocuments(query),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const createNotification = async (data, options = {}) => {
  if (data.actorId && String(data.actorId) === String(data.recipientId)) return null;
  if (!(await shouldCreateNotification(data.recipientId, data.type))) return null;

  const notification = await Notification.findOneAndUpdate(
    { recipientId: data.recipientId, eventKey: data.eventKey },
    { $setOnInsert: data },
    { new: true, upsert: true, setDefaultsOnInsert: true, session: options.session },
  );

  const count = await Notification.countDocuments({
    recipientId: data.recipientId,
    isRead: false,
    deletedAt: null,
  }).session(options.session || null);

  getSocket().emitToUser(data.recipientId, 'notification:new', { notification });
  getSocket().emitToUser(data.recipientId, 'notification:count', { unreadCount: count });

  return notification;
};

const markRead = async (user, id) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: id, recipientId: user._id, deletedAt: null },
    { isRead: true, readAt: new Date() },
    { new: true },
  );
  if (!notification) throw new ApiError(httpStatus.NOT_FOUND, 'Notification not found');
  getSocket().emitToUser(user._id, 'notification:count', { unreadCount: await unreadCount(user) });
  return notification;
};

const markAllRead = async (user) => {
  await Notification.updateMany(
    { recipientId: user._id, isRead: false, deletedAt: null },
    { isRead: true, readAt: new Date() },
  );
  getSocket().emitToUser(user._id, 'notification:count', { unreadCount: 0 });
  return { unreadCount: 0 };
};

const archiveNotification = async (user, id) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: id, recipientId: user._id, deletedAt: null },
    { deletedAt: new Date() },
    { new: true },
  );
  if (!notification) throw new ApiError(httpStatus.NOT_FOUND, 'Notification not found');
  getSocket().emitToUser(user._id, 'notification:count', { unreadCount: await unreadCount(user) });
  return notification;
};

module.exports = {
  archiveNotification,
  createNotification,
  listNotifications,
  markAllRead,
  markRead,
  unreadCount,
};
