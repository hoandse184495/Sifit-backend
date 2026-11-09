const express = require('express');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');
const roles = require('../constants/roles');
const controller = require('../controllers/productReport.controller');
const {
  createSchema,
  mineSchema,
  listSchema,
  resolveSchema,
  reporterSchema,
  validate,
} = require('../validations/productReport.validation');
const router = express.Router();
router.post(
  '/products/:productId/reports',
  authenticate,
  authorize(roles.BUYER, roles.SELLER),
  validate(createSchema),
  controller.create,
);
router.get(
  '/product-reports/my',
  authenticate,
  authorize(roles.BUYER, roles.SELLER),
  validate(mineSchema),
  controller.mine,
);
router.get(
  '/admin/product-reports',
  authenticate,
  authorize(roles.ADMIN),
  validate(listSchema),
  controller.list,
);
router.patch(
  '/admin/product-reports/:id/resolve',
  authenticate,
  authorize(roles.ADMIN),
  validate(resolveSchema),
  controller.resolve,
);
router.patch(
  '/admin/product-reports/:id/reporter',
  authenticate,
  authorize(roles.ADMIN),
  validate(reporterSchema),
  controller.moderateReporter,
);
module.exports = router;
