const authorize = require('../middlewares/authorize.middleware');
const roles = require('../constants/roles');
const express = require('express');
const productController = require('../controllers/product.controller');
const authenticate = require('../middlewares/auth.middleware');
const { uploadProductImages } = require('../middlewares/upload.middleware');
const {
  createProductSchema,
  idParamSchema,
  imageParamSchema,
  listProductsSchema,
  updateProductSchema,
  validate,
} = require('../validations/product.validation');

const router = express.Router();

router.get('/', validate(listProductsSchema), productController.listProducts);
router.get('/my', authenticate, authorize(roles.SELLER), productController.listMyProducts);
router.get('/:id', validate(idParamSchema), productController.getProduct);
router.post(
  '/',
  authenticate,
  authorize(roles.SELLER),
  validate(createProductSchema),
  productController.createProduct,
);
router.patch(
  '/:id',
  authenticate,
  authorize(roles.SELLER),
  validate(updateProductSchema),
  productController.updateProduct,
);
router.delete(
  '/:id',
  authenticate,
  authorize(roles.SELLER),
  validate(idParamSchema),
  productController.deleteProduct,
);
router.post(
  '/:id/submit',
  authenticate,
  authorize(roles.SELLER),
  validate(idParamSchema),
  productController.submitProduct,
);
router.post(
  '/:id/images',
  authenticate,
  authorize(roles.SELLER),
  validate(idParamSchema),
  uploadProductImages.array('images', 8),
  productController.uploadImages,
);
router.delete(
  '/:id/images/:publicId',
  authenticate,
  authorize(roles.SELLER),
  validate(imageParamSchema),
  productController.deleteImage,
);

module.exports = router;
