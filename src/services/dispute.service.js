const httpStatus = require('../constants/httpStatus');
const roles = require('../constants/roles');
const Dispute = require('../models/dispute.model');
const Order = require('../models/order.model');
const ApiError = require('../utils/ApiError');
const notificationEventService = require('./notificationEvent.service');
const { getDisputeEligibility } = require('./disputePolicy');

const activeStatuses = ['OPEN', 'UNDER_REVIEW'];

const openDispute = async (orderId, user, data) => {
  const order = await Order.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  if (!order.buyerId.equals(user._id))
    throw new ApiError(httpStatus.FORBIDDEN, 'Only buyer can open dispute');
  const eligibility = getDisputeEligibility(order);
  if (!eligibility.eligible) {
    throw new ApiError(httpStatus.CONFLICT, 'Dispute window is not active');
  }
  if (!eligibility.allowedReasons.includes(data.reason)) {
    throw new ApiError(
      httpStatus.CONFLICT,
      'Before delivery, only an item-not-received dispute can be opened',
    );
  }
  const existing = await Dispute.exists({ orderId, status: { $in: activeStatuses } });
  if (existing) throw new ApiError(httpStatus.CONFLICT, 'An active dispute already exists');
  const dispute = await Dispute.create({
    ...data,
    orderId,
    buyerId: order.buyerId,
    sellerId: order.sellerId,
  });
  await notificationEventService.enqueueNotificationEvent({
    eventKey: `dispute:${dispute._id}:opened:seller`,
    type: 'NOTIFICATION_CREATE',
    payload: {
      recipientId: order.sellerId,
      actorId: user._id,
      type: 'DISPUTE_OPENED',
      title: 'Dispute opened',
      body: 'A buyer opened a dispute for an order',
      resourceType: 'DISPUTE',
      resourceId: dispute._id,
      eventKey: `dispute:${dispute._id}:opened`,
    },
  });
  return dispute;
};

const listMyDisputes = async (user, { page = 1, limit = 20, status } = {}) => {
  const query = { $or: [{ buyerId: user._id }, { sellerId: user._id }] };
  if (status) query.status = status;
  const [items, total] = await Promise.all([
    Dispute.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Dispute.countDocuments(query),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const getDispute = async (id, user) => {
  const dispute = await Dispute.findById(id);
  if (!dispute) throw new ApiError(httpStatus.NOT_FOUND, 'Dispute not found');
  const allowed =
    user.role === roles.ADMIN ||
    dispute.buyerId.equals(user._id) ||
    dispute.sellerId.equals(user._id);
  if (!allowed) throw new ApiError(httpStatus.FORBIDDEN, 'Access denied');
  return dispute;
};

const listAdminDisputes = async ({ page = 1, limit = 20, status } = {}) => {
  const query = {};
  if (status) query.status = status;
  const [items, total] = await Promise.all([
    Dispute.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Dispute.countDocuments(query),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const reviewDispute = async (id, admin, note) => {
  const dispute = await getDispute(id, admin);
  if (!activeStatuses.includes(dispute.status))
    throw new ApiError(httpStatus.CONFLICT, 'Dispute is not reviewable');
  dispute.status = 'UNDER_REVIEW';
  dispute.auditHistory.push({ action: 'REVIEW', actorId: admin._id, note });
  return dispute.save();
};

const resolveDispute = async (id, admin, { status, resolution }) => {
  const dispute = await getDispute(id, admin);
  if (!activeStatuses.includes(dispute.status))
    throw new ApiError(httpStatus.CONFLICT, 'Dispute is not resolvable');
  dispute.status = status;
  dispute.resolution = resolution;
  dispute.resolvedAt = new Date();
  dispute.resolvedBy = admin._id;
  dispute.auditHistory.push({ action: 'RESOLVE', actorId: admin._id, note: resolution });
  const saved = await dispute.save();
  await Promise.all([
    notificationEventService.enqueueNotificationEvent({
      eventKey: `dispute:${saved._id}:resolved:buyer`,
      type: 'NOTIFICATION_CREATE',
      payload: {
        recipientId: saved.buyerId,
        actorId: admin._id,
        type: 'DISPUTE_RESOLVED',
        title: 'Dispute resolved',
        body: 'A dispute has been resolved',
        resourceType: 'DISPUTE',
        resourceId: saved._id,
        eventKey: `dispute:${saved._id}:resolved`,
      },
    }),
    notificationEventService.enqueueNotificationEvent({
      eventKey: `dispute:${saved._id}:resolved:seller`,
      type: 'NOTIFICATION_CREATE',
      payload: {
        recipientId: saved.sellerId,
        actorId: admin._id,
        type: 'DISPUTE_RESOLVED',
        title: 'Dispute resolved',
        body: 'A dispute has been resolved',
        resourceType: 'DISPUTE',
        resourceId: saved._id,
        eventKey: `dispute:${saved._id}:resolved`,
      },
    }),
  ]);
  return saved;
};

module.exports = {
  getDispute,
  listAdminDisputes,
  listMyDisputes,
  openDispute,
  resolveDispute,
  reviewDispute,
};
