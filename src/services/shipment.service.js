const mongoose = require('mongoose');
const httpStatus = require('../constants/httpStatus');
const roles = require('../constants/roles');
const Shipment = require('../models/shipment.model');
const ShipmentEvent = require('../models/shipmentEvent.model');
const ApiError = require('../utils/ApiError');
const { markDelivered } = require('./delivery.service');
const notificationEventService = require('./notificationEvent.service');
const { getShippingProvider } = require('./shippingProviders/shippingProvider.factory');

const canAccessShipment = (shipment, user) =>
  user.role === roles.ADMIN ||
  shipment.buyerId.equals(user._id) ||
  shipment.sellerId.equals(user._id);

const getShipment = async (id, user) => {
  const shipment = await Shipment.findById(id);
  if (!shipment) throw new ApiError(httpStatus.NOT_FOUND, 'Shipment not found');
  if (!canAccessShipment(shipment, user)) throw new ApiError(httpStatus.FORBIDDEN, 'Access denied');
  return shipment;
};

const getOrderTracking = async (orderId, user) => {
  const shipment = await Shipment.findOne({ orderId });
  if (!shipment) throw new ApiError(httpStatus.NOT_FOUND, 'Shipment not found');
  if (!canAccessShipment(shipment, user)) throw new ApiError(httpStatus.FORBIDDEN, 'Access denied');
  return shipment;
};

const listSellerShipments = async (user, { page = 1, limit = 20, status } = {}) => {
  const query = { sellerId: user._id };
  if (status) query.status = status;
  const [items, total] = await Promise.all([
    Shipment.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Shipment.countDocuments(query),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const listAdminShipments = async ({ page = 1, limit = 20, status } = {}) => {
  const query = {};
  if (status) query.status = status;
  const [items, total] = await Promise.all([
    Shipment.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Shipment.countDocuments(query),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const statusRank = {
  PENDING: 0,
  READY_FOR_PICKUP: 1,
  PICKED_UP: 2,
  IN_TRANSIT: 3,
  OUT_FOR_DELIVERY: 4,
  DELIVERED: 5,
  DELIVERY_FAILED: 5,
  RETURNING: 6,
  RETURNED: 7,
  CANCELLED: 7,
};

const handleWebhook = async ({ providerName, payload, signature }) => {
  const provider = getShippingProvider(providerName);
  if (!provider.verifyWebhook({ payload, signature })) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid webhook signature');
  }
  const event = provider.parseWebhook(payload);
  const shipment = await Shipment.findOne({
    provider: providerName,
    providerShipmentId: event.providerShipmentId,
  });
  if (!shipment) throw new ApiError(httpStatus.NOT_FOUND, 'Shipment not found');

  try {
    await ShipmentEvent.create({
      shipmentId: shipment._id,
      provider: providerName,
      providerEventId: event.providerEventId,
      eventType: event.eventType,
      status: event.status,
      occurredAt: event.occurredAt,
      metadata: event.metadata,
    });
  } catch (error) {
    if (error.code === 11000) return { duplicate: true };
    throw error;
  }

  if (statusRank[event.status] < statusRank[shipment.status]) return { ignored: true };
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (event.status === 'DELIVERED') {
        await markDelivered({ shipmentId: shipment._id, deliveredAt: event.occurredAt, session });
      } else {
        await Shipment.updateOne(
          { _id: shipment._id },
          {
            status: event.status,
            ...(event.status === 'PICKED_UP' ? { pickedUpAt: event.occurredAt } : {}),
            ...(event.status === 'DELIVERY_FAILED' ? { failedAt: event.occurredAt } : {}),
            ...(event.status === 'CANCELLED' ? { cancelledAt: event.occurredAt } : {}),
          },
          { session },
        );
      }

      if (['PICKED_UP', 'DELIVERED'].includes(event.status)) {
        const type = event.status === 'PICKED_UP' ? 'SHIPMENT_PICKED_UP' : 'SHIPMENT_DELIVERED';
        const title = event.status === 'PICKED_UP' ? 'Shipment picked up' : 'Shipment delivered';
        const body =
          event.status === 'PICKED_UP'
            ? 'Your shipment has been picked up'
            : 'Your shipment has been delivered';
        await Promise.all([
          notificationEventService.enqueueNotificationEvent(
            {
              eventKey: `shipment:${shipment._id}:${event.status.toLowerCase()}:buyer`,
              type: 'NOTIFICATION_CREATE',
              payload: {
                recipientId: shipment.buyerId,
                type,
                title,
                body,
                resourceType: 'SHIPMENT',
                resourceId: shipment._id,
                eventKey: `shipment:${shipment._id}:${event.status.toLowerCase()}`,
              },
            },
            { session },
          ),
          notificationEventService.enqueueNotificationEvent(
            {
              eventKey: `shipment:${shipment._id}:${event.status.toLowerCase()}:seller`,
              type: 'NOTIFICATION_CREATE',
              payload: {
                recipientId: shipment.sellerId,
                type,
                title,
                body,
                resourceType: 'SHIPMENT',
                resourceId: shipment._id,
                eventKey: `shipment:${shipment._id}:${event.status.toLowerCase()}`,
              },
            },
            { session },
          ),
        ]);
      }
    });
  } finally {
    await session.endSession();
  }
  return { processed: true };
};

module.exports = {
  getOrderTracking,
  getShipment,
  handleWebhook,
  listAdminShipments,
  listSellerShipments,
};
