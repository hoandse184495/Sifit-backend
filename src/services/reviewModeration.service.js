const httpStatus = require('../constants/httpStatus');
const ProductReview = require('../models/productReview.model');
const SellerRating = require('../models/sellerRating.model');
const ApiError = require('../utils/ApiError');
const sellerReputationService = require('./sellerReputation.service');

const findReviewLike = async (id) => {
  const productReview = await ProductReview.findById(id);
  if (productReview) return { doc: productReview, type: 'product' };
  const sellerRating = await SellerRating.findById(id);
  if (sellerRating) return { doc: sellerRating, type: 'seller' };
  throw new ApiError(httpStatus.NOT_FOUND, 'Review not found');
};

const moderate = async ({ id, admin, action, reason }) => {
  const { doc, type } = await findReviewLike(id);
  if (action === 'restore' && doc.status === 'REMOVED') {
    throw new ApiError(
      httpStatus.CONFLICT,
      'Author-removed review cannot be restored by moderation',
    );
  }
  doc.status = action === 'hide' ? 'HIDDEN' : 'PUBLISHED';
  doc.moderation = doc.moderation || {};
  doc.moderation.reason = reason;
  doc.moderation.moderatedBy = admin._id;
  doc.moderation.moderatedAt = new Date();
  doc.moderation.history = doc.moderation.history || [];
  doc.moderation.history.push({ action, reason, actorId: admin._id });
  await doc.save();
  if (type === 'seller') await sellerReputationService.rebuildSellerStats(doc.sellerId);
  return doc;
};

const listReviews = async ({ page = 1, limit = 20, type }) => {
  if (type === 'seller') {
    const [items, total] = await Promise.all([
      SellerRating.find()
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      SellerRating.countDocuments(),
    ]);
    return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }
  const [items, total] = await Promise.all([
    ProductReview.find()
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    ProductReview.countDocuments(),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

module.exports = { listReviews, moderate };
