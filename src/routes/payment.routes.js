const authorize = require('../middlewares/authorize.middleware');
const roles = require('../constants/roles');
const express = require('express');
const paymentController = require('../controllers/payment.controller');
const authenticate = require('../middlewares/auth.middleware');
const {
  createPaymentSchema,
  idParamSchema,
  validate,
} = require('../validations/payment.validation');

const router = express.Router();

router.use(authenticate);

// Sellers may settle historical purchases, but cannot create new checkout orders.
router.post(
  '/',
  authorize(roles.BUYER, roles.SELLER),
  validate(createPaymentSchema),
  paymentController.createPayment,
);
router.get('/:id', validate(idParamSchema), paymentController.getPayment);

module.exports = router;
