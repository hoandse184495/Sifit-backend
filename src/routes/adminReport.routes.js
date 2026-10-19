const express = require('express');
const reportController = require('../controllers/adminReport.controller');
const roles = require('../constants/roles');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');
const { exportSchema, validate } = require('../validations/adminReport.validation');

const router = express.Router();

router.use(authenticate, authorize(roles.ADMIN));

router.get('/reports/orders/export', validate(exportSchema), reportController.exportOrders);
router.get(
  '/reports/commissions/export',
  validate(exportSchema),
  reportController.exportCommissions,
);
router.get('/reports/users/export', validate(exportSchema), reportController.exportUsers);

module.exports = router;
