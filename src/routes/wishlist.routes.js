const authorize = require('../middlewares/authorize.middleware');
const roles = require('../constants/roles');
const express = require('express');
const wishlistController = require('../controllers/wishlist.controller');
const authenticate = require('../middlewares/auth.middleware');
const {
  addWishlistItemSchema,
  productIdParamSchema,
  validate,
} = require('../validations/wishlist.validation');

const router = express.Router();

router.use(authenticate, authorize(roles.BUYER));

router.get('/', wishlistController.getWishlist);
router.post('/items', validate(addWishlistItemSchema), wishlistController.addItem);
router.get('/items/:productId', validate(productIdParamSchema), wishlistController.checkItem);
router.delete('/items/:productId', validate(productIdParamSchema), wishlistController.removeItem);
router.delete('/items', wishlistController.clearWishlist);

module.exports = router;
