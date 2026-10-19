const express = require('express');
const disputeController = require('../controllers/dispute.controller');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');
const roles = require('../constants/roles');
const {
  idParamSchema,
  listSchema,
  openDisputeSchema,
  resolveSchema,
  reviewSchema,
  validate,
} = require('../validations/dispute.validation');

const router = express.Router();

router.post(
  '/orders/:id/disputes',
  authenticate,
  validate(openDisputeSchema),
  disputeController.openDispute,
);
router.get('/disputes/my', authenticate, validate(listSchema), disputeController.listMyDisputes);
router.get('/disputes/:id', authenticate, validate(idParamSchema), disputeController.getDispute);
router.get(
  '/admin/disputes',
  authenticate,
  authorize(roles.ADMIN),
  validate(listSchema),
  disputeController.listAdminDisputes,
);
router.patch(
  '/admin/disputes/:id/review',
  authenticate,
  authorize(roles.ADMIN),
  validate(reviewSchema),
  disputeController.reviewDispute,
);
router.patch(
  '/admin/disputes/:id/resolve',
  authenticate,
  authorize(roles.ADMIN),
  validate(resolveSchema),
  disputeController.resolveDispute,
);

module.exports = router;
