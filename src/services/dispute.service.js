const httpStatus = require('../constants/httpStatus');
const roles = require('../constants/roles');
const Dispute = require('../models/dispute.model');
const Order = require('../models/order.model');
const ApiError = require('../utils/ApiError');
const notificationEventService = require('./notificationEvent.service');
const { getDisputeEligibility } = require('./disputePolicy');
const transaction = require('../utils/withTransaction');

const activeStatuses = ['OPEN', 'UNDER_REVIEW'];

const openDispute = async (orderId, user, data) => {
  return require('../utils/withTransaction')(async (session) => {
    const order = await Order.findOneAndUpdate(
      { _id: orderId },
      { $inc: { settlementVersion: 1 } },
      { new: true, session },
    );
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
    const existing = await Dispute.exists({
      orderId,
      $or: [
        { status: { $in: activeStatuses } },
        { status: 'RESOLVED_BUYER', refundSettledAt: null },
      ],
    }).session(session);
    if (existing) throw new ApiError(httpStatus.CONFLICT, 'An active dispute already exists');
    const [dispute] = await Dispute.create(
      [
        {
          ...data,
          orderId,
          buyerId: order.buyerId,
          sellerId: order.sellerId,
          reviewBy: new Date(Date.now() + require('../config/env').DISPUTE_REVIEW_DAYS * 86400000),
        },
      ],
      { session },
    );
    await notificationEventService.enqueueNotificationEvent(
      {
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
      },
      { session },
    );
    return dispute;
  });
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
  return transaction(async (session) => {
    const initial = await Dispute.findById(id).session(session);
    if (!initial) throw new ApiError(404, 'Dispute not found');
    await Order.updateOne(
      { _id: initial.orderId },
      { $inc: { settlementVersion: 1 } },
      { session },
    );
    const dispute = await Dispute.findOneAndUpdate(
      { _id: id, status: { $in: activeStatuses } },
      {
        $set: { status: 'UNDER_REVIEW' },
        $inc: { contentVersion: 1 },
        $push: { auditHistory: { action: 'REVIEW', actorId: admin._id, note, at: new Date() } },
      },
      { new: true, session },
    );
    if (!dispute) throw new ApiError(409, 'Dispute is not reviewable');
    return dispute;
  });
};

const resolveDispute = async (
  id,
  admin,
  { status, resolution, expectedVersion, returnRequired = false, returnDetails },
) => {
  const saved = await transaction(async (session) => {
    const initial = await Dispute.findById(id).session(session);
    if (!initial) throw new ApiError(404, 'Dispute not found');
    const cases = require('./disputeCase.service');
    cases.assertIndependentAdmin(initial, admin);
    if (expectedVersion !== undefined) cases.assertVersion(initial, expectedVersion);
    else if (returnRequired || initial.evidenceCount > 0 || initial.messageCount > 0)
      throw new ApiError(409, 'Cần tải lại và kiểm tra bằng chứng mới trước khi chốt khiếu nại.');
    if (
      returnRequired &&
      (status !== 'RESOLVED_BUYER' ||
        !returnDetails ||
        new Date(returnDetails.shipBy) <= new Date() ||
        new Date(returnDetails.shipBy) > new Date(Date.now() + 90 * 86400000))
    )
      throw new ApiError(400, 'Cần địa chỉ nhận trả và hạn gửi trong tương lai, tối đa 90 ngày.');
    const order = await Order.findOneAndUpdate(
      { _id: initial.orderId },
      { $inc: { settlementVersion: 1 } },
      { new: true, session },
    );
    const at = new Date();
    if (!order) throw new ApiError(404, 'Order not found');
    if (returnRequired && !order.deliveredAt && !order.buyerConfirmedAt)
      throw new ApiError(409, 'Cần xác minh người mua đã nhận hàng trước khi yêu cầu gửi trả.');
    const saved = await Dispute.findOneAndUpdate(
      { _id: id, status: { $in: activeStatuses } },
      {
        $set: {
          status,
          resolution,
          resolvedAt: at,
          resolvedBy: admin._id,
          returnFlow: returnRequired
            ? {
                ...returnDetails,
                required: true,
                status: 'AWAITING_SHIPMENT',
                requestedAt: at,
                requestedBy: admin._id,
              }
            : { required: false, status: 'NOT_REQUIRED' },
        },
        $inc: { contentVersion: 1 },
        $push: { auditHistory: { action: 'RESOLVE', actorId: admin._id, note: resolution, at } },
      },
      { new: true, session },
    );
    if (!saved) throw new ApiError(409, 'Dispute is not resolvable');
    await require('./adminAudit.service').record({
      admin,
      session,
      action: 'DISPUTE_RESOLVED',
      resourceType: 'DISPUTE',
      resourceId: saved._id,
      reason: resolution.slice(0, 1000),
      after: { status, returnRequired },
    });
    await notificationEventService.enqueueNotificationEvent(
      {
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
      },
      { session },
    );
    await notificationEventService.enqueueNotificationEvent(
      {
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
      },
      { session },
    );
    return saved;
  });
  await require('../utils/flushNotifications')([saved._id]);
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
