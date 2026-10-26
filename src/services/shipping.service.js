const httpStatus = require('../constants/httpStatus');
const paymentStatus = require('../constants/paymentStatus');
const Address = require('../models/address.model');
const Order = require('../models/order.model');
const SellerProfile = require('../models/sellerProfile.model');
const Shipment = require('../models/shipment.model');
const ApiError = require('../utils/ApiError');
const { getShippingProvider } = require('./shippingProviders/shippingProvider.factory');
const notificationEventService = require('./notificationEvent.service');

const snapshotAddress = (address) => ({
  recipientName: address.recipientName,
  phone: address.phone,
  addressLine: address.addressLine,
  ward: address.ward,
  province: address.province,
  postalCode: address.postalCode,
});

const getSellerOrder = async (seller, orderId) => {
  const order = await Order.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  if (!order.sellerId.equals(seller._id))
    throw new ApiError(httpStatus.FORBIDDEN, 'Only the seller can ship this order');
  return order;
};

const quote = async (seller, data) => {
  const order = await getSellerOrder(seller, data.orderId);
  const address = await Address.findOne({
    _id: data.pickupAddressId,
    userId: seller._id,
    isActive: true,
  });
  if (!address) throw new ApiError(httpStatus.NOT_FOUND, 'Pickup address not found');
  const provider = getShippingProvider();
  const quoteResult = await provider.calculateShippingFee(data);
  return { ...quoteResult, orderId: order.id };
};

const createShipment = async (seller, orderId, data) => {
  const order = await getSellerOrder(seller, orderId);
  const existing = await Shipment.findOne({
    orderId,
    status: { $nin: ['CANCELLED', 'RETURNED', 'DELIVERY_FAILED'] },
  });
  if (existing) return existing;

  if (order.paymentStatus !== paymentStatus.PAID) {
    throw new ApiError(httpStatus.CONFLICT, 'Order must be paid before shipment creation');
  }
  if (['CANCELLED', 'REFUNDED'].includes(order.orderStatus)) {
    throw new ApiError(httpStatus.CONFLICT, 'Cancelled or refunded orders cannot be shipped');
  }
  const profile = await SellerProfile.findOne({ userId: seller._id, status: 'ACTIVE' });
  if (!profile) throw new ApiError(httpStatus.CONFLICT, 'Active seller profile is required');
  const pickup = await Address.findOne({
    _id: data.pickupAddressId,
    userId: seller._id,
    isActive: true,
  });
  if (!pickup) throw new ApiError(httpStatus.NOT_FOUND, 'Pickup address not found');

  const provider = getShippingProvider();
  const quoteResult = await provider.calculateShippingFee(data);
  const providerShipment = await provider.createShipment({ order, pickup, data });
  const shipment = await Shipment.create({
    orderId: order._id,
    sellerId: order.sellerId,
    buyerId: order.buyerId,
    provider: provider.name,
    trackingNumber: providerShipment.trackingNumber,
    providerShipmentId: providerShipment.providerShipmentId,
    idempotencyKey: data.idempotencyKey,
    pickupAddressSnapshot: snapshotAddress(pickup),
    deliveryAddressSnapshot: {
      recipientName: order.shippingAddress.recipientName,
      phone: order.shippingAddress.phone,
      addressLine: order.shippingAddress.addressLine,
      ward: order.shippingAddress.ward,
      province: order.shippingAddress.city,
      postalCode: order.shippingAddress.postalCode,
    },
    shippingFee: quoteResult.shippingFee,
    codAmount: 0,
    weightGrams: data.weightGrams,
    packageLengthCm: data.packageLengthCm,
    packageWidthCm: data.packageWidthCm,
    packageHeightCm: data.packageHeightCm,
    status: providerShipment.status,
    estimatedDeliveryAt: providerShipment.estimatedDeliveryAt,
  });
  order.orderStatus = 'PROCESSING';
  await order.save();
  await notificationEventService.enqueueNotificationEvent({
    eventKey: `shipment:${shipment._id}:created:buyer`,
    type: 'NOTIFICATION_CREATE',
    payload: {
      recipientId: order.buyerId,
      actorId: seller._id,
      type: 'SHIPMENT_CREATED',
      title: 'Shipment created',
      body: 'Your order shipment has been created',
      resourceType: 'SHIPMENT',
      resourceId: shipment._id,
      eventKey: `shipment:${shipment._id}:created`,
    },
  });
  return shipment;
};

module.exports = { createShipment, quote };
