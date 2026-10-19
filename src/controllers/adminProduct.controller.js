const { z } = require('zod');
const httpStatus = require('../constants/httpStatus');
const adminProductService = require('../services/adminProduct.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const rejectSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});

const listPendingProducts = asyncHandler(async (req, res) => {
  const parsedQuery = paginationSchema.safeParse(req.query);

  if (!parsedQuery.success) {
    return res.status(400).json({
      success: false,
      message: 'Invalid request data',
      errors: parsedQuery.error.issues,
    });
  }

  const result = await adminProductService.listPendingProducts(parsedQuery.data);
  const response = new ApiResponse(httpStatus.OK, result, 'Pending products retrieved');

  return res.status(response.statusCode).json(response);
});

const listProducts = asyncHandler(async (req, res) => {
  const result = await adminProductService.listProducts({
    page: Number(req.query.page || 1),
    limit: Math.min(Number(req.query.limit || 20), 100),
    status: req.query.status,
    sellerId: req.query.sellerId,
    search: req.query.search,
  });
  const response = new ApiResponse(httpStatus.OK, result, 'Products retrieved');

  return res.status(response.statusCode).json(response);
});

const approveProduct = asyncHandler(async (req, res) => {
  const product = await adminProductService.approveProduct(req.params.id, req.user);
  const response = new ApiResponse(httpStatus.OK, { product }, 'Product approved');

  res.status(response.statusCode).json(response);
});

const rejectProduct = asyncHandler(async (req, res) => {
  const parsedBody = rejectSchema.safeParse(req.body);

  if (!parsedBody.success) {
    return res.status(400).json({
      success: false,
      message: 'Invalid request data',
      errors: parsedBody.error.issues,
    });
  }

  const product = await adminProductService.rejectProduct(
    req.params.id,
    parsedBody.data.reason,
    req.user,
  );
  const response = new ApiResponse(httpStatus.OK, { product }, 'Product rejected');

  return res.status(response.statusCode).json(response);
});

const hideProduct = asyncHandler(async (req, res) => {
  const parsedBody = rejectSchema.safeParse(req.body);

  if (!parsedBody.success) {
    return res.status(400).json({
      success: false,
      message: 'Invalid request data',
      errors: parsedBody.error.issues,
    });
  }

  const product = await adminProductService.hideProduct(
    req.params.id,
    parsedBody.data.reason,
    req.user,
  );
  const response = new ApiResponse(httpStatus.OK, { product }, 'Product hidden');

  return res.status(response.statusCode).json(response);
});

module.exports = {
  approveProduct,
  hideProduct,
  listProducts,
  listPendingProducts,
  rejectProduct,
};
