const express = require('express');
const adminProductController = require('../controllers/adminProduct.controller');
const categoryController = require('../controllers/category.controller');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');
const roles = require('../constants/roles');
const {
  createCategorySchema,
  updateCategorySchema,
  validate: validateCategory,
} = require('../validations/category.validation');
const { idParamSchema, validate: validateProduct } = require('../validations/product.validation');

const router = express.Router();

router.use(authenticate, authorize(roles.ADMIN));

router.get('/products', adminProductController.listProducts);
router.get('/products/pending', adminProductController.listPendingProducts);
router.patch(
  '/products/:id/approve',
  validateProduct(idParamSchema),
  adminProductController.approveProduct,
);
router.patch(
  '/products/:id/reject',
  validateProduct(idParamSchema),
  adminProductController.rejectProduct,
);
router.patch(
  '/products/:id/hide',
  validateProduct(idParamSchema),
  adminProductController.hideProduct,
);
router.post(
  '/categories',
  validateCategory(createCategorySchema),
  categoryController.createCategory,
);
router.patch(
  '/categories/:id',
  validateCategory(updateCategorySchema),
  categoryController.updateCategory,
);

module.exports = router;
