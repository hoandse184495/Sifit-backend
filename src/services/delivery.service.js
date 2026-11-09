const mongoose = require('mongoose');
const env = require('../config/env');
const httpStatus = require('../constants/httpStatus');
const orderStatus = require('../constants/orderStatus');
const paymentStatus = require('../constants/paymentStatus');
const roles = require('../constants/roles');
const Order = require('../models/order.model');
const Shipment = require('../models/shipment.model');
const ApiError = require('../utils/ApiError');
const notificationEventService = require('./notificationEvent.service');

const protectionEndsAtFrom = (deliveredAt) =>
  new Date(deliveredAt.getTime() + env.BUYER_PROTECTION_DAYS * 24 * 60 * 60 * 1000);

const markDelivered = async ({ shipmentId, deliveredAt = new Date(), session }) => {
  const shipment = await Shipment.findById(shipmentId).session(session || null);
  if (!shipment) throw new ApiError(httpStatus.NOT_FOUND, 'Shipment not found');
  if (shipment.status === 'DELIVERED') return shipment;

  shipment.status = 'DELIVERED';
  shipment.deliveredAt = deliveredAt;
  await shipment.save({ session });

  await Order.updateOne(
    {
      _id: shipment.orderId,
      paymentStatus: paymentStatus.PAID,
      orderStatus: { $in: [orderStatus.PAID, orderStatus.PROCESSING, orderStatus.SHIPPED] },
    },
    {
      orderStatus: orderStatus.DELIVERED,
      deliveredAt,
      protectionEndsAt: protectionEndsAtFrom(deliveredAt),
    },
    { session },
  );

  return shipment;
};

const confirmReceipt = async (orderId, user) => {
  return require('../utils/withTransaction')(async (session) => {
    const order = await Order.findById(orderId).session(session);
    if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
    if (!order.buyerId.equals(user._id))
      throw new ApiError(httpStatus.FORBIDDEN, 'Only the buyer can confirm receipt');
    if (order.buyerConfirmedAt) return order;
    if (order.orderStatus === orderStatus.SHIPPED && order.paymentStatus === paymentStatus.PAID) {
      const manual = await Shipment.findOne({
        orderId,
        provider: 'manual',
        handoverConfirmedAt: { $ne: null },
        status: { $in: ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'] },
      }).session(session);
      if (manual) {
        await markDelivered({ shipmentId: manual._id, deliveredAt: new Date(), session });
        order.orderStatus = orderStatus.DELIVERED;
        order.deliveredAt = new Date();
        order.protectionEndsAt = protectionEndsAtFrom(order.deliveredAt);
      }
    }
    if (order.orderStatus !== orderStatus.DELIVERED || order.paymentStatus !== paymentStatus.PAID) {
      throw new ApiError(httpStatus.CONFLICT, 'Order has not been verified as delivered');
    }
    order.buyerConfirmedAt = new Date();
    await order.save({ session });
    await notificationEventService.enqueueNotificationEvent(
      {
        eventKey: `order:${order._id}:delivery-confirmed`,
        type: 'NOTIFICATION_CREATE',
        payload: {
          recipientId: order.sellerId,
          actorId: user._id,
          type: 'DELIVERY_CONFIRMED',
          title: 'Buyer confirmed receipt',
          body: 'The buyer confirmed receipt for an order',
          resourceType: 'ORDER',
          resourceId: order._id,
          eventKey: `order:${order._id}:delivery-confirmed`,
        },
      },
      { session },
    );
    return order;
  });
};

const reviewDelivery = async ({ shipmentId, admin, status, reason }) => {
  if (admin.role !== roles.ADMIN) throw new ApiError(httpStatus.FORBIDDEN, 'Admin access required');
  const session = await mongoose.startSession();
  try {
    let shipment;
    await session.withTransaction(async () => {
      shipment = await Shipment.findById(shipmentId).session(session);
      if (!shipment) throw new ApiError(httpStatus.NOT_FOUND, 'Shipment not found');
      if (['DELIVERED', 'RETURNING', 'RETURNED', 'CANCELLED'].includes(shipment.status)) {
        throw new ApiError(httpStatus.CONFLICT, 'Shipment can no longer be reviewed');
      }
      const order = await Order.findById(shipment.orderId).session(session);
      if (
        !order ||
        order.paymentStatus !== paymentStatus.PAID ||
        ![orderStatus.PAID, orderStatus.PROCESSING, orderStatus.SHIPPED].includes(order.orderStatus)
      ) {
        throw new ApiError(httpStatus.CONFLICT, 'Order is not eligible for delivery review');
      }
      if (status === 'DELIVERED') {
        shipment = await markDelivered({ shipmentId, deliveredAt: new Date(), session });
      } else {
        shipment.status = 'DELIVERY_FAILED';
        shipment.failedAt = new Date();
        await shipment.save({ session });
      }
      shipment.deliveryReviews.push({ status, reason, adminId: admin._id, reviewedAt: new Date() });
      await shipment.save({ session });
    });
    return shipment;
  } finally {
    await session.endSession();
  }
};

const completeEligibleOrders = async ({ now = new Date(), limit = 50 } = {}) => {
  const pendingAdminCount = await Order.countDocuments({
    orderStatus: orderStatus.DELIVERED,
    paymentStatus: paymentStatus.PAID,
    protectionEndsAt: { $lte: now },
  }).limit(limit);
  return { completedCount: 0, pendingAdminCount };
};

module.exports = {
  completeEligibleOrders,
  confirmReceipt,
  markDelivered,
  protectionEndsAtFrom,
  reviewDelivery,
};
