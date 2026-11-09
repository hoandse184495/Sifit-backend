const express = require('express');
const { z } = require('zod');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const service = require('../services/marketplaceWorkflow.service');
const { objectId } = require('../validations/common.validation');
const {
  bankSchema,
  completeSchema,
  recordPayoutSchema,
  manualShipmentSchema,
  handoverSchema,
  validate,
} = require('../validations/marketplaceWorkflow.validation');
const router = express.Router();
const route = (method, path, role, schema, key, action) =>
  router[method](
    path,
    authenticate,
    authorize(role),
    validate(schema),
    asyncHandler(async (req, res) => {
      const result = await action(req);
      if (method !== 'get' && result?._id)
        await require('../utils/flushNotifications')(
          [result._id, result.orderId, ...(result.orderIds || [])].filter(Boolean),
        );
      res.json(new ApiResponse(200, key ? { [key]: result } : result, 'Đã cập nhật'));
    }),
  );
route(
  'get',
  '/admin/payment-transactions',
  'ADMIN',
  z.object({
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(20),
      status: z.enum(['MATCHED', 'UNMATCHED']).optional(),
    }),
  }),
  null,
  async (req) => {
    const Model = require('../models/paymentTransaction.model');
    const { page, limit, status } = req.query;
    const filter = status ? { status } : {};
    const [items, total] = await Promise.all([
      Model.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Model.countDocuments(filter),
    ]);
    return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  },
);
const idSchema = z.object({ params: z.object({ id: objectId }) });
route('get', '/seller/bank-account', 'SELLER', z.object({}), 'bankAccount', (req) =>
  service.getBank(req.user),
);
route('put', '/seller/bank-account', 'SELLER', bankSchema, 'bankAccount', (req) =>
  service.saveBank(req.user, req.body),
);
route('post', '/seller/orders/:id/accept', 'SELLER', idSchema, 'order', (req) =>
  service.acceptOrder(req.user, req.params.id),
);
route(
  'post',
  '/seller/orders/:orderId/manual-shipment',
  'SELLER',
  manualShipmentSchema,
  'shipment',
  (req) => service.manualShipment(req.user, req.params.orderId, req.body),
);
route('post', '/seller/shipments/:id/handover', 'SELLER', handoverSchema, 'shipment', (req) =>
  service.handover(req.user, req.params.id, req.body),
);
route('post', '/admin/orders/:id/complete', 'ADMIN', completeSchema, 'order', (req) =>
  service.completeOrder(req.user, req.params.id, req.body),
);
route('post', '/admin/payouts/:id/record-transfer', 'ADMIN', recordPayoutSchema, 'payout', (req) =>
  service.recordManualPayout(req.user, req.params.id, req.body),
);
route(
  'post',
  '/admin/payouts/evaluate',
  'ADMIN',
  z.object({ body: z.object({}).strict() }),
  'result',
  () => require('../services/settlementEligibility.service').evaluateEligibleOrders(),
);
module.exports = router;
