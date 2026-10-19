const express = require('express');
const { z } = require('zod');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');
const roles = require('../constants/roles');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const { validate, objectId } = require('../validations/common.validation');
const Category = require('../models/category.model');
const Product = require('../models/product.model');
const ProductReview = require('../models/productReview.model');
const SellerRating = require('../models/sellerRating.model');
const UserBlock = require('../models/userBlock.model');
const Dispute = require('../models/dispute.model');
const router = express.Router();
const idSchema = z.object({ params: z.object({ id: objectId }) });

for (const role of [roles.ADMIN, roles.SELLER]) {
  router.get(`/${role.toLowerCase()}/products/:id`, authenticate, authorize(role), validate(idSchema), asyncHandler(async (req, res) => {
    const product = await Product.findOne({ _id: req.params.id, deletedAt: null, ...(role === roles.SELLER ? { sellerId: req.user._id } : {}) })
      .populate('sellerId', 'fullName avatar').populate('categoryId', 'name slug');
    if (!product) throw new ApiError(404, 'Product not found');
    res.json(new ApiResponse(200, { product }, 'Product retrieved'));
  }));
}
router.get('/seller/disputes', authenticate, authorize(roles.SELLER), validate(z.object({ query: z.object({
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(['OPEN', 'UNDER_REVIEW', 'RESOLVED_BUYER', 'RESOLVED_SELLER', 'CLOSED']).optional(),
}) })), asyncHandler(async (req, res) => {
  const { page, limit, status } = req.query;
  const query = { sellerId: req.user._id, ...(status ? { status } : {}) };
  const [items, total] = await Promise.all([
    Dispute.find(query).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit),
    Dispute.countDocuments(query),
  ]);
  res.json(new ApiResponse(200, { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }, 'Seller disputes retrieved'));
}));

router.get('/admin/categories', authenticate, authorize(roles.ADMIN), asyncHandler(async (req, res) => {
  res.json(new ApiResponse(200, { categories: await Category.find().sort({ name: 1 }) }, 'Categories retrieved'));
}));
router.get('/products/facets', asyncHandler(async (req, res) => {
  const query = { status: 'ACTIVE', deletedAt: null };
  const [brands, sizes] = await Promise.all([Product.distinct('brand', query), Product.distinct('size', query)]);
  res.json(new ApiResponse(200, { brands: brands.filter(Boolean).sort(), sizes: sizes.filter(Boolean).sort() }, 'Product facets retrieved'));
}));
router.get('/seller/reviews', authenticate, authorize(roles.SELLER), validate(z.object({ query: z.object({
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(['PUBLISHED', 'HIDDEN', 'REMOVED']).optional(),
}) })), asyncHandler(async (req, res) => {
  const { page, limit, status } = req.query;
  const query = { sellerId: req.user._id, ...(status ? { status } : {}) };
  const [items, total] = await Promise.all([
    ProductReview.find(query).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit)
      .populate('buyerId', 'fullName avatar').populate('productId', 'title images'),
    ProductReview.countDocuments(query),
  ]);
  res.json(new ApiResponse(200, { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }, 'Seller reviews retrieved'));
}));
router.get('/users/:id/block', authenticate, validate(z.object({ params: z.object({ id: objectId }) })), asyncHandler(async (req, res) => {
  const blocked = Boolean(await UserBlock.exists({ blockerId: req.user._id, blockedId: req.params.id, active: true }));
  res.json(new ApiResponse(200, { blocked }, 'Block status retrieved'));
}));
router.get('/account/reviews/:id', authenticate, validate(z.object({ params: z.object({ id: objectId }) })), asyncHandler(async (req, res) => {
  let type = 'product';
  let review = await ProductReview.findById(req.params.id).populate('buyerId', 'fullName avatar');
  if (!review) { type = 'seller'; review = await SellerRating.findById(req.params.id).populate('buyerId', 'fullName avatar'); }
  if (!review) throw new ApiError(404, 'Review not found');
  if (review.status !== 'PUBLISHED' && req.user.role !== roles.ADMIN &&
    !review.buyerId?._id.equals(req.user._id) && !review.sellerId.equals(req.user._id)) throw new ApiError(404, 'Review not found');
  res.json(new ApiResponse(200, { review, type }, 'Review retrieved'));
}));
module.exports = router;
