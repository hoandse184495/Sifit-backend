const env = require('../config/env');
const httpStatus = require('../constants/httpStatus');
const orderStatus = require('../constants/orderStatus');
const paymentStatus = require('../constants/paymentStatus');
const roles = require('../constants/roles');
const { deleteAsset, uploadBuffer } = require('../config/cloudinary');
const Dispute = require('../models/dispute.model');
const Order = require('../models/order.model');
const Product = require('../models/product.model');
const ProductReview = require('../models/productReview.model');
const ApiError = require('../utils/ApiError');
const { calculateRatingSummary } = require('../utils/ratingCalculator');
const notificationService = require('./notification.service');

const getEditDeadline = (review) =>
  new Date(review.createdAt.getTime() + env.REVIEW_EDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

const ownReviewDetails = (review) => ({
  ...review.toObject(),
  editDeadline: getEditDeadline(review),
  canEdit: review.status !== 'REMOVED' && getEditDeadline(review) >= new Date(),
});

const assertEditable = (review) => {
  if (review.status === 'REMOVED') {
    throw new ApiError(httpStatus.CONFLICT, 'Removed reviews cannot be edited');
  }
  if (getEditDeadline(review) < new Date()) {
    throw new ApiError(httpStatus.CONFLICT, 'Review editing window has expired');
  }
};

const publicReviewableStatuses = ['ACTIVE', 'RESERVED', 'SOLD', 'ARCHIVED'];

const isImage = (buffer) =>
  (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ||
  (buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a) ||
  (buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP');

const assertEligibility = async ({ user, orderId, productId }) => {
  const order = await Order.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  if (!order.buyerId.equals(user._id))
    throw new ApiError(httpStatus.FORBIDDEN, 'You cannot review this order');
  if (order.sellerId.equals(user._id))
    throw new ApiError(httpStatus.FORBIDDEN, 'You cannot review your own product');
  const item = order.items.find((entry) => entry.productId.equals(productId));
  if (!item) throw new ApiError(httpStatus.BAD_REQUEST, 'Product is not part of this order');
  if (
    order.orderStatus !== orderStatus.COMPLETED ||
    order.paymentStatus !== paymentStatus.PAID ||
    !order.deliveredAt
  ) {
    throw new ApiError(httpStatus.CONFLICT, 'Order is not eligible for review');
  }
  const activeDispute = await Dispute.exists({
    orderId: order._id,
    status: { $in: ['OPEN', 'UNDER_REVIEW'] },
  });
  if (activeDispute) throw new ApiError(httpStatus.CONFLICT, 'Active dispute blocks review');
  return { order, item };
};

const createReview = async (user, data) => {
  const { order } = await assertEligibility({
    user,
    orderId: data.orderId,
    productId: data.productId,
  });
  const review = await ProductReview.create({
    productId: data.productId,
    orderId: order._id,
    buyerId: user._id,
    sellerId: order.sellerId,
    rating: data.rating,
    title: data.title,
    comment: data.comment,
    isVerifiedPurchase: true,
  });
  await notificationService.createNotification({
    recipientId: order.sellerId,
    actorId: user._id,
    type: 'NEW_PRODUCT_REVIEW',
    title: 'New product review',
    body: `${user.fullName} reviewed your product`,
    resourceType: 'REVIEW',
    resourceId: review._id,
    eventKey: `product-review:${review._id}`,
  });
  return review;
};

const assertPublicReviewableProduct = async (productId) => {
  const product = await Product.findById(productId).select('status deletedAt');
  if (!product || product.deletedAt || !publicReviewableStatuses.includes(product.status)) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');
  }
};

const listProductReviews = async (productId, { page = 1, limit = 20, rating }) => {
  await assertPublicReviewableProduct(productId);
  const query = { productId, status: 'PUBLISHED' };
  if (rating) query.rating = rating;
  const [items, total] = await Promise.all([
    ProductReview.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({ path: 'buyerId', select: 'fullName avatar' }),
    ProductReview.countDocuments(query),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const getProductReviewSummary = async (productId) => {
  await assertPublicReviewableProduct(productId);
  const reviews = await ProductReview.find({ productId, status: 'PUBLISHED' }).select('rating');
  return calculateRatingSummary(reviews.map((review) => review.rating));
};

const listMyReviews = async (user, { page = 1, limit = 20 }) => {
  const [items, total] = await Promise.all([
    ProductReview.find({ buyerId: user._id })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    ProductReview.countDocuments({ buyerId: user._id }),
  ]);
  return {
    items: items.map(ownReviewDetails),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
};

const getReview = async (id, user) => {
  const review = await ProductReview.findById(id).populate({
    path: 'buyerId',
    select: 'fullName avatar',
  });
  if (!review) throw new ApiError(httpStatus.NOT_FOUND, 'Review not found');
  if (review.status === 'PUBLISHED') return review;
  const allowed =
    user &&
    (user.role === roles.ADMIN ||
      review.buyerId._id?.equals?.(user._id) ||
      review.sellerId.equals(user._id));
  if (!allowed) throw new ApiError(httpStatus.NOT_FOUND, 'Review not found');
  return review;
};

const updateReview = async (id, user, data) => {
  const review = await ProductReview.findById(id);
  if (!review) throw new ApiError(httpStatus.NOT_FOUND, 'Review not found');
  if (!review.buyerId.equals(user._id))
    throw new ApiError(httpStatus.FORBIDDEN, 'Only the author can edit review');
  assertEditable(review);
  ['rating', 'title', 'comment'].forEach((field) => {
    if (data[field] !== undefined) review[field] = data[field];
  });
  review.editedAt = new Date();
  return review.save();
};

const removeReview = async (id, user) => {
  const review = await ProductReview.findById(id);
  if (!review) throw new ApiError(httpStatus.NOT_FOUND, 'Review not found');
  if (!review.buyerId.equals(user._id) && user.role !== roles.ADMIN) {
    throw new ApiError(httpStatus.FORBIDDEN, 'You cannot remove this review');
  }
  review.status = 'REMOVED';
  review.removedAt = new Date();
  review.removedBy = user._id;
  return review.save();
};

const replyToReview = async (id, user, text) => {
  const review = await ProductReview.findById(id);
  if (!review || review.status === 'REMOVED')
    throw new ApiError(httpStatus.NOT_FOUND, 'Review not found');
  if (!review.sellerId.equals(user._id))
    throw new ApiError(httpStatus.FORBIDDEN, 'Only seller can reply');
  if (review.sellerReply?.text)
    throw new ApiError(httpStatus.CONFLICT, 'Review already has a seller reply');
  review.sellerReply = { text, repliedAt: new Date() };
  return review.save();
};

const uploadImages = async (id, user, files = []) => {
  const review = await ProductReview.findById(id);
  if (!review) throw new ApiError(httpStatus.NOT_FOUND, 'Review not found');
  if (!review.buyerId.equals(user._id))
    throw new ApiError(httpStatus.FORBIDDEN, 'Only author can upload images');
  assertEditable(review);
  if (!files.length) throw new ApiError(httpStatus.BAD_REQUEST, 'At least one image is required');
  if (review.images.length + files.length > 5)
    throw new ApiError(httpStatus.CONFLICT, 'Review image limit exceeded');
  files.forEach((file) => {
    if (!isImage(file.buffer)) throw new ApiError(415, 'Unsupported image type');
  });
  const uploaded = [];
  try {
    for (const file of files) {
      const result = await uploadBuffer(file.buffer, {
        folder: 'sifit/reviews',
        resource_type: 'image',
      });
      uploaded.push({ url: result.secure_url, publicId: result.public_id });
    }
    const updated = await ProductReview.findOneAndUpdate(
      {
        _id: review._id,
        buyerId: user._id,
        status: { $ne: 'REMOVED' },
        $expr: { $lte: [{ $add: [{ $size: '$images' }, uploaded.length] }, 5] },
      },
      { $push: { images: { $each: uploaded } } },
      { new: true },
    );
    if (!updated) throw new ApiError(httpStatus.CONFLICT, 'Review image limit exceeded');
    return updated;
  } catch (error) {
    await Promise.allSettled(uploaded.map((image) => deleteAsset(image.publicId)));
    throw error;
  }
};

const deleteImage = async (id, encodedPublicId, user) => {
  const publicId = decodeURIComponent(encodedPublicId);
  const review = await ProductReview.findById(id);
  if (!review) throw new ApiError(httpStatus.NOT_FOUND, 'Review not found');
  if (!review.buyerId.equals(user._id))
    throw new ApiError(httpStatus.FORBIDDEN, 'Only author can delete images');
  assertEditable(review);
  review.images = review.images.filter((image) => image.publicId !== publicId);
  await review.save();
  await Promise.allSettled([deleteAsset(publicId)]);
  return review;
};

module.exports = {
  ownReviewDetails,
  createReview,
  deleteImage,
  getProductReviewSummary,
  getReview,
  listMyReviews,
  listProductReviews,
  removeReview,
  replyToReview,
  updateReview,
  uploadImages,
};
