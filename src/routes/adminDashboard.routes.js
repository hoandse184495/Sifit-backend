const express = require('express');
const dashboardController = require('../controllers/adminDashboard.controller');
const analyticsController = require('../controllers/adminAnalytics.controller');
const auditController = require('../controllers/adminAudit.controller');
const roles = require('../constants/roles');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');
const {
  analyticsSchema,
  auditListSchema,
  dateRangeSchema,
  validate,
} = require('../validations/adminDashboard.validation');

const router = express.Router();

router.use(authenticate, authorize(roles.ADMIN));

router.get('/dashboard/overview', validate(dateRangeSchema), dashboardController.overview);
router.get('/dashboard/revenue', validate(analyticsSchema), analyticsController.revenue);
router.get('/dashboard/orders', validate(analyticsSchema), analyticsController.orders);
router.get('/dashboard/users', validate(analyticsSchema), analyticsController.users);
router.get('/dashboard/products', validate(analyticsSchema), analyticsController.products);
router.get('/analytics/commissions', validate(analyticsSchema), analyticsController.commissions);
router.get('/audit-logs', validate(auditListSchema), auditController.listAuditLogs);

module.exports = router;
