const express = require('express');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const service = require('../services/shopFollow.service');
const {
  idSchema,
  followSchema,
  preferenceSchema,
  listSchema,
  validate,
} = require('../validations/shopFollow.validation');
const router = express.Router();
router.get(
  '/shops/:id/followers/count',
  validate(idSchema),
  asyncHandler(async (req, res) =>
    res.json(
      new ApiResponse(
        200,
        { followerCount: await service.countFollowers(req.params.id) },
        'Số người theo dõi',
      ),
    ),
  ),
);
const buyer = [authenticate, authorize('BUYER')];
router.get(
  '/shops/:id/follow',
  ...buyer,
  validate(idSchema),
  asyncHandler(async (req, res) =>
    res.json(
      new ApiResponse(200, await service.state(req.user, req.params.id), 'Trạng thái theo dõi'),
    ),
  ),
);
router.put(
  '/shops/:id/follow',
  ...buyer,
  validate(followSchema),
  asyncHandler(async (req, res) =>
    res.json(
      new ApiResponse(
        200,
        await service.followShop(req.user, req.params.id, req.body),
        'Đã theo dõi cửa hàng',
      ),
    ),
  ),
);
router.delete(
  '/shops/:id/follow',
  ...buyer,
  validate(idSchema),
  asyncHandler(async (req, res) =>
    res.json(
      new ApiResponse(
        200,
        await service.unfollowShop(req.user, req.params.id),
        'Đã bỏ theo dõi cửa hàng',
      ),
    ),
  ),
);
router.patch(
  '/shops/:id/follow',
  ...buyer,
  validate(preferenceSchema),
  asyncHandler(async (req, res) =>
    res.json(
      new ApiResponse(
        200,
        await service.updatePreference(req.user, req.params.id, req.body),
        'Đã cập nhật thông báo cửa hàng',
      ),
    ),
  ),
);
router.get(
  '/shop-follows/my',
  ...buyer,
  validate(listSchema),
  asyncHandler(async (req, res) =>
    res.json(
      new ApiResponse(
        200,
        await service.listFollowing(req.user, req.query),
        'Cửa hàng đang theo dõi',
      ),
    ),
  ),
);
router.get(
  '/shop-follows/products',
  ...buyer,
  validate(listSchema),
  asyncHandler(async (req, res) =>
    res.json(
      new ApiResponse(
        200,
        await service.feed(req.user, req.query),
        'Sản phẩm từ cửa hàng đang theo dõi',
      ),
    ),
  ),
);
module.exports = router;
