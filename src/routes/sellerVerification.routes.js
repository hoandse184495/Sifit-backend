const express = require('express');
const sellerVerificationController = require('../controllers/sellerVerification.controller');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');
const roles = require('../constants/roles');
const { idParamSchema, validate } = require('../validations/shipping.validation');

const router = express.Router();

router.post(
  '/seller/verification/submit',
  authenticate,
  sellerVerificationController.submitVerification,
);
router.get('/seller/verification/status', authenticate, sellerVerificationController.getStatus);
router.get(
  '/admin/seller-verifications',
  authenticate,
  authorize(roles.ADMIN),
  sellerVerificationController.listPending,
);
router.patch(
  '/admin/seller-verifications/:id/approve',
  authenticate,
  authorize(roles.ADMIN),
  validate(idParamSchema),
  sellerVerificationController.approve,
);
router.patch(
  '/admin/seller-verifications/:id/reject',
  authenticate,
  authorize(roles.ADMIN),
  validate(idParamSchema),
  sellerVerificationController.reject,
);

module.exports = router;
