const httpStatus = require('../constants/httpStatus');
const deliveryService = require('../services/delivery.service');
const shipmentService = require('../services/shipment.service');
const shippingService = require('../services/shipping.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const createShipment = asyncHandler(async (req, res) => {
  const shipment = await shippingService.createShipment(req.user, req.params.orderId, req.body);
  res.status(201).json(new ApiResponse(httpStatus.CREATED, { shipment }, 'Shipment created'));
});
const getShipment = asyncHandler(async (req, res) => {
  const shipment = await shipmentService.getShipment(req.params.id, req.user);
  res.status(200).json(new ApiResponse(httpStatus.OK, { shipment }, 'Shipment retrieved'));
});
const getOrderTracking = asyncHandler(async (req, res) => {
  const shipment = await shipmentService.getOrderTracking(req.params.orderId, req.user);
  res.status(200).json(new ApiResponse(httpStatus.OK, { shipment }, 'Tracking retrieved'));
});
const listSellerShipments = asyncHandler(async (req, res) => {
  const result = await shipmentService.listSellerShipments(req.user, req.query);
  res.status(200).json(new ApiResponse(httpStatus.OK, result, 'Seller shipments retrieved'));
});
const listAdminShipments = asyncHandler(async (req, res) => {
  const result = await shipmentService.listAdminShipments(req.query);
  res.status(200).json(new ApiResponse(httpStatus.OK, result, 'Shipments retrieved'));
});
const handleWebhook = asyncHandler(async (req, res) => {
  const result = await shipmentService.handleWebhook({
    providerName: req.params.provider,
    payload: req.body,
    signature: req.get('x-sifit-signature'),
  });
  res.status(200).json({ success: true, message: 'Shipping webhook processed', data: result });
});
const confirmReceipt = asyncHandler(async (req, res) => {
  const order = await deliveryService.confirmReceipt(req.params.id, req.user);
  res.status(200).json(new ApiResponse(httpStatus.OK, { order }, 'Receipt confirmed'));
});
const reviewDelivery = asyncHandler(async (req, res) => {
  const shipment = await deliveryService.reviewDelivery({
    shipmentId: req.params.id,
    admin: req.user,
    status: req.body.status,
    reason: req.body.reason,
  });
  res.status(200).json(new ApiResponse(httpStatus.OK, { shipment }, 'Delivery reviewed'));
});

module.exports = {
  confirmReceipt,
  createShipment,
  getOrderTracking,
  getShipment,
  handleWebhook,
  listAdminShipments,
  listSellerShipments,
  reviewDelivery,
};
