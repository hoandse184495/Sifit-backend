const httpStatus = require('../constants/httpStatus');
const orderStatus = require('../constants/orderStatus');
const paymentStatus = require('../constants/paymentStatus');
const roles = require('../constants/roles');
const Dispute = require('../models/dispute.model');
const Order = require('../models/order.model');
const SellerProfile = require('../models/sellerProfile.model');
const SellerRating = require('../models/sellerRating.model');
const ApiError = require('../utils/ApiError');
const notificationService = require('./notification.service');
const sellerReputationService = require('./sellerReputation.service');

const assertEligibility = async (user, orderId) => {
  const order = await Order.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  if (!order.buyerId.equals(user._id))
    throw new ApiError(httpStatus.FORBIDDEN, 'You cannot rate this order');
  if (order.sellerId.equals(user._id))
    throw new ApiError(httpStatus.FORBIDDEN, 'You cannot rate yourself');
  if (
    order.orderStatus !== orderStatus.COMPLETED ||
    order.paymentStatus !== paymentStatus.PAID ||
    !order.deliveredAt
  ) {
    throw new ApiError(httpStatus.CONFLICT, 'Order is not eligible for seller rating');
  }
  const activeDispute = await Dispute.exists({
    orderId: order._id,
    status: { $in: ['OPEN', 'UNDER_REVIEW'] },
  });
  if (activeDispute) throw new ApiError(httpStatus.CONFLICT, 'Active dispute blocks seller rating');
  return order;
};

const createSellerRating = async (user, data) => {
  const order = await assertEligibility(user, data.orderId);
  const rating = await SellerRating.create({
    orderId: order._id,
    buyerId: user._id,
    sellerId: order.sellerId,
    rating: data.rating,
    communicationRating: data.communicationRating,
    shippingRating: data.shippingRating,
    descriptionAccuracyRating: data.descriptionAccuracyRating,
    comment: data.comment,
    isVerifiedPurchase: true,
  });
  await sellerReputationService.rebuildSellerStats(order.sellerId);
  await notificationService.createNotification({
    recipientId: order.sellerId,
    actorId: user._id,
    type: 'NEW_SELLER_RATING',
    title: 'New seller rating',
    body: `${user.fullName} rated your shop`,
    resourceType: 'REVIEW',
    resourceId: rating._id,
    eventKey: `seller-rating:${rating._id}`,
  });
  return rating;
};

const listShopRatings = async (slug, { page = 1, limit = 20 }) => {
  const profile = await SellerProfile.findOne({ shopSlug: slug, status: 'ACTIVE' });
  if (!profile) throw new ApiError(httpStatus.NOT_FOUND, 'Shop not found');
  const query = { sellerId: profile.userId, status: 'PUBLISHED' };
  const [items, total] = await Promise.all([
    SellerRating.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({ path: 'buyerId', select: 'fullName avatar' }),
    SellerRating.countDocuments(query),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const listReceivedRatings = async (user, { page = 1, limit = 20 }) => {
  const [items, total] = await Promise.all([
    SellerRating.find({ sellerId: user._id })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    SellerRating.countDocuments({ sellerId: user._id }),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const getSummary = (user) => sellerReputationService.getSellerRatingSummary(user._id);

const canAccessRating = (rating, user) =>
  rating.status === 'PUBLISHED' ||
  user.role === roles.ADMIN ||
  rating.buyerId.equals(user._id) ||
  rating.sellerId.equals(user._id);

module.exports = {
  canAccessRating,
  createSellerRating,
  getSummary,
  listReceivedRatings,
  listShopRatings,
};
