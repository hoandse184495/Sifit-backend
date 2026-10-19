const authorize = require('../middlewares/authorize.middleware');
const roles = require('../constants/roles');
const express = require('express');
const orderController = require('../controllers/order.controller');
const authenticate = require('../middlewares/auth.middleware');
const {
  checkoutSchema,
  idParamSchema,
  orderListSchema,
  validate,
} = require('../validations/order.validation');

const router = express.Router();

router.use(authenticate);

router.post('/', authorize(roles.BUYER), validate(checkoutSchema), orderController.createOrder);
router.get('/my', validate(orderListSchema), orderController.listMyOrders);
router.get('/:id', validate(idParamSchema), orderController.getOrder);
router.post('/:id/cancel', validate(idParamSchema), orderController.cancelOrder);

module.exports = router;
