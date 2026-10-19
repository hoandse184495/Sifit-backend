const express = require('express');
const adminFinanceController = require('../controllers/adminFinance.controller');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');
const roles = require('../constants/roles');
const {
  adminListSchema,
  idParamSchema,
  validate: validatePayment,
} = require('../validations/payment.validation');
const {
  refundRequestSchema,
  validate: validateRefund,
} = require('../validations/refund.validation');

const router = express.Router();

router.use(authenticate, authorize(roles.ADMIN));

router.get('/payments', validatePayment(adminListSchema), adminFinanceController.listPayments);
router.get(
  '/commissions',
  validatePayment(adminListSchema),
  adminFinanceController.listCommissions,
);
router.get('/payouts', validatePayment(adminListSchema), adminFinanceController.listPayouts);
router.get('/payouts/:id', validatePayment(idParamSchema), adminFinanceController.getPayout);
router.get('/financial-summary', adminFinanceController.financialSummary);
router.post(
  '/payouts/:id/approve',
  validatePayment(idParamSchema),
  adminFinanceController.approvePayout,
);
router.post('/refunds', validateRefund(refundRequestSchema), adminFinanceController.requestRefund);

module.exports = router;
