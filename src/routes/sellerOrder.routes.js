const express = require('express');
const sellerOrderController = require('../controllers/sellerOrder.controller');
const authenticate = require('../middlewares/auth.middleware');
const { idParamSchema, orderListSchema, validate } = require('../validations/order.validation');

const router = express.Router();

router.use(authenticate);

router.get('/orders', validate(orderListSchema), sellerOrderController.listSellerOrders);
router.get('/orders/:id', validate(idParamSchema), sellerOrderController.getSellerOrder);

module.exports = router;
