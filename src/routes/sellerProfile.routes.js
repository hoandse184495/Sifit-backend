const express = require('express');
const sellerProfileController = require('../controllers/sellerProfile.controller');
const authenticate = require('../middlewares/auth.middleware');
const {
  createProfileSchema,
  listShopSchema,
  slugParamSchema,
  updateProfileSchema,
  validate,
} = require('../validations/sellerProfile.validation');

const router = express.Router();

router.get('/shops', validate(listShopSchema), sellerProfileController.listPublicShops);
router.get('/shops/:slug', validate(slugParamSchema), sellerProfileController.getPublicShop);
router.post(
  '/seller/profile',
  authenticate,
  validate(createProfileSchema),
  sellerProfileController.createProfile,
);
router.get('/seller/profile', authenticate, sellerProfileController.getOwnProfile);
router.patch(
  '/seller/profile',
  authenticate,
  validate(updateProfileSchema),
  sellerProfileController.updateProfile,
);

module.exports = router;
