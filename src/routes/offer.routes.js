const router = require('express').Router();
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const service = require('../services/offer.service');
const v = require('../validations/offer.validation');

router.post(
  '/products/:id/offers',
  authenticate,
  authorize('BUYER'),
  v.validate(v.createSchema),
  asyncHandler(async (req, res) =>
    res
      .status(201)
      .json(
        new ApiResponse(
          201,
          { offer: await service.createOffer(req.user, req.params.id, req.body) },
          'Đã gửi đề nghị giá',
        ),
      ),
  ),
);
router.get(
  '/offers/my',
  authenticate,
  authorize('BUYER'),
  v.validate(v.listSchema),
  asyncHandler(async (req, res) =>
    res.json(new ApiResponse(200, await service.list(req.user, req.query), 'Đề nghị của tôi')),
  ),
);
router.get(
  '/seller/offers',
  authenticate,
  authorize('SELLER'),
  v.validate(v.listSchema),
  asyncHandler(async (req, res) =>
    res.json(new ApiResponse(200, await service.list(req.user, req.query), 'Đề nghị cho shop')),
  ),
);
router.get(
  '/offers/:id',
  authenticate,
  authorize('BUYER', 'SELLER'),
  v.validate(v.idSchema),
  asyncHandler(async (req, res) =>
    res.json(
      new ApiResponse(
        200,
        { offer: await service.getOffer(req.user, req.params.id) },
        'Chi tiết đề nghị',
      ),
    ),
  ),
);
router.post(
  '/seller/offers/:id/respond',
  authenticate,
  authorize('SELLER'),
  v.validate(v.respondSchema),
  asyncHandler(async (req, res) =>
    res.json(
      new ApiResponse(
        200,
        { offer: await service.respond(req.user, req.params.id, req.body) },
        'Đã xử lý đề nghị',
      ),
    ),
  ),
);
router.post(
  '/offers/:id/withdraw',
  authenticate,
  authorize('BUYER'),
  v.validate(v.idSchema),
  asyncHandler(async (req, res) =>
    res.json(
      new ApiResponse(
        200,
        { offer: await service.withdraw(req.user, req.params.id) },
        'Đã rút đề nghị',
      ),
    ),
  ),
);
module.exports = router;
