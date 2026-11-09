const service = require('../services/productReport.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');
exports.create = asyncHandler(async (req, res) =>
  res
    .status(201)
    .json(
      new ApiResponse(
        201,
        { report: await service.createReport(req.user, req.params.productId, req.body) },
        'Đã gửi báo cáo. Quản trị viên sẽ kiểm tra.',
      ),
    ),
);
exports.mine = asyncHandler(async (req, res) =>
  res.json(
    new ApiResponse(
      200,
      await service.list({ ...req.query, reporterId: req.user._id }),
      'Báo cáo của bạn',
    ),
  ),
);
exports.list = asyncHandler(async (req, res) =>
  res.json(new ApiResponse(200, await service.list(req.query, true), 'Danh sách báo cáo sản phẩm')),
);
exports.resolve = asyncHandler(async (req, res) =>
  res.json(
    new ApiResponse(
      200,
      { report: await service.resolveReport(req.user, req.params.id, req.body) },
      'Đã xử lý báo cáo',
    ),
  ),
);
exports.moderateReporter = asyncHandler(async (req, res) =>
  res.json(
    new ApiResponse(
      200,
      { policy: await service.moderateReporter(req.user, req.params.id, req.body) },
      'Đã cập nhật quyền báo cáo',
    ),
  ),
);
