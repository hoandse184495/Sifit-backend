const authorize = require('../middlewares/authorize.middleware');
const roles = require('../constants/roles');
const express = require('express');
const sellerRatingController = require('../controllers/sellerRating.controller');
const authenticate = require('../middlewares/auth.middleware');
const {
  createSellerRatingSchema,
  listSchema,
  shopSlugRatingsSchema,
  validate,
} = require('../validations/sellerRating.validation');

const router = express.Router();

router.post(
  '/reviews/sellers',
  authenticate,
  authorize(roles.BUYER, roles.SELLER),
  validate(createSellerRatingSchema),
  sellerRatingController.createSellerRating,
);
router.get(
  '/shops/:slug/ratings',
  validate(shopSlugRatingsSchema),
  sellerRatingController.listShopRatings,
);
router.get(
  '/shops/:slug/ratings/summary',
  validate(shopSlugRatingsSchema),
  sellerRatingController.getShopRatingSummary,
);
router.get(
  '/seller/ratings',
  authenticate,
  validate(listSchema),
  sellerRatingController.listReceivedRatings,
);
router.get(
  '/seller/ratings/summary',
  authenticate,
  sellerRatingController.getMySellerRatingSummary,
);

module.exports = router;
