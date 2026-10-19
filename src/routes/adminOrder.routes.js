const express = require('express');
const adminOrderController = require('../controllers/adminOrder.controller');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');
const roles = require('../constants/roles');
const { idParamSchema, orderListSchema, validate } = require('../validations/order.validation');

const router = express.Router();

router.use(authenticate, authorize(roles.ADMIN));

router.get('/orders', validate(orderListSchema), adminOrderController.listOrders);
router.get('/orders/:id', validate(idParamSchema), adminOrderController.getOrder);

module.exports = router;
