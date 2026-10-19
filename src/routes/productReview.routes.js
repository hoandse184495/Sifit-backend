const authorize = require('../middlewares/authorize.middleware');
const roles = require('../constants/roles');
const express = require('express');
const productReviewController = require('../controllers/productReview.controller');
const authenticate = require('../middlewares/auth.middleware');
const { uploadProductImages } = require('../middlewares/upload.middleware');
const {
  createProductReviewSchema,
  idParamSchema,
  myReviewsSchema,
  productIdParamSchema,
  productReviewsListSchema,
  replySchema,
  updateProductReviewSchema,
  validate,
} = require('../validations/productReview.validation');

const router = express.Router();

router.get(
  '/products/:productId/reviews',
  validate(productReviewsListSchema),
  productReviewController.listProductReviews,
);
router.get(
  '/products/:productId/reviews/summary',
  validate(productIdParamSchema),
  productReviewController.getProductReviewSummary,
);
router.post(
  '/reviews/products',
  authenticate,
  authorize(roles.BUYER, roles.SELLER),
  validate(createProductReviewSchema),
  productReviewController.createReview,
);
router.get(
  '/reviews/my',
  authenticate,
  validate(myReviewsSchema),
  productReviewController.listMyReviews,
);
router.get('/reviews/:id', validate(idParamSchema), productReviewController.getReview);
router.patch(
  '/reviews/:id',
  authenticate,
  validate(updateProductReviewSchema),
  productReviewController.updateReview,
);
router.delete(
  '/reviews/:id',
  authenticate,
  validate(idParamSchema),
  productReviewController.removeReview,
);
router.post(
  '/reviews/:id/reply',
  authenticate,
  authorize(roles.SELLER),
  validate(replySchema),
  productReviewController.replyToReview,
);
router.post(
  '/reviews/:id/images',
  authenticate,
  validate(idParamSchema),
  uploadProductImages.array('images', 5),
  productReviewController.uploadImages,
);
router.delete('/reviews/:id/images/:publicId', authenticate, productReviewController.deleteImage);

module.exports = router;
