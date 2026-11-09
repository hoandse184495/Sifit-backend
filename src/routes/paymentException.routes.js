const express = require('express');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const schemas = require('../validations/paymentException.validation');
const service = require('../services/paymentException.service');
const router = express.Router();
const admin = [authenticate, authorize('ADMIN')];
const respond = (fn) =>
  asyncHandler(async (req, res) =>
    res.json(new ApiResponse(200, await fn(req), 'Payment review retrieved')),
  );
router.get(
  '/admin/payment-exceptions',
  ...admin,
  schemas.validate(schemas.listSchema),
  respond((req) => service.list(req.query)),
);
router.get(
  '/payments/:id/review',
  authenticate,
  schemas.validate(schemas.idSchema),
  respond((req) => service.detail(req.user, req.params.id)),
);
router.post(
  '/admin/payment-exceptions/:id/decisions',
  ...admin,
  schemas.validate(schemas.decisionSchema),
  respond((req) => service.decide(req.user, req.params.id, req.body)),
);
router.post(
  '/admin/payment-exceptions/:id/recheck',
  ...admin,
  schemas.validate(schemas.idSchema),
  respond((req) => service.recheck(req.user, req.params.id)),
);
module.exports = router;
