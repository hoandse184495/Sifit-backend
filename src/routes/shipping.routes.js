const express = require('express');
const shippingController = require('../controllers/shipping.controller');
const shipmentController = require('../controllers/shipment.controller');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');
const roles = require('../constants/roles');
const {
  createShipmentSchema,
  idParamSchema,
  listSchema,
  orderIdParamSchema,
  quoteSchema,
  reviewDeliverySchema,
  validate,
} = require('../validations/shipping.validation');

const router = express.Router();

router.post(
  '/shipping/quote',
  authenticate,
  authorize(roles.SELLER),
  validate(quoteSchema),
  shippingController.quote,
);
router.post(
  '/seller/orders/:orderId/shipments',
  authenticate,
  validate(createShipmentSchema),
  shipmentController.createShipment,
);
router.get('/shipments/:id', authenticate, validate(idParamSchema), shipmentController.getShipment);
router.get(
  '/orders/:orderId/tracking',
  authenticate,
  validate(orderIdParamSchema),
  shipmentController.getOrderTracking,
);
router.get(
  '/seller/shipments',
  authenticate,
  validate(listSchema),
  shipmentController.listSellerShipments,
);
router.get(
  '/admin/shipments',
  authenticate,
  authorize(roles.ADMIN),
  validate(listSchema),
  shipmentController.listAdminShipments,
);
router.post('/webhooks/shipping/:provider', shipmentController.handleWebhook);
router.post(
  '/orders/:id/confirm-receipt',
  authenticate,
  validate(idParamSchema),
  shipmentController.confirmReceipt,
);
router.post(
  '/admin/shipments/:id/review-delivery',
  authenticate,
  authorize(roles.ADMIN),
  validate(reviewDeliverySchema),
  shipmentController.reviewDelivery,
);

module.exports = router;
