const authorize = require('../middlewares/authorize.middleware');
const roles = require('../constants/roles');
const express = require('express');
const cartController = require('../controllers/cart.controller');
const authenticate = require('../middlewares/auth.middleware');
const {
  addCartItemSchema,
  productIdParamSchema,
  validate,
} = require('../validations/cart.validation');

const router = express.Router();

router.use(authenticate, authorize(roles.BUYER));

router.get('/', cartController.getCart);
router.post('/items', validate(addCartItemSchema), cartController.addItem);
router.delete('/items/:productId', validate(productIdParamSchema), cartController.removeItem);
router.delete('/', cartController.clearCart);

module.exports = router;
