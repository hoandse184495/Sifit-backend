const httpStatus = require('../constants/httpStatus');
const Order = require('../models/order.model');
const SellerProfile = require('../models/sellerProfile.model');
const User = require('../models/user.model');
const ApiError = require('../utils/ApiError');
const auditService = require('./adminAudit.service');
const userService = require('./adminUser.service');
const sellerReputationService = require('./sellerReputation.service');

const listSellers = async ({ page = 1, limit = 20, verificationStatus, status, search }) => {
  const query = {};
  if (verificationStatus) query.verificationStatus = verificationStatus;
  if (status) query.status = status;
  if (search) {
    const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ shopName: pattern }, { shopSlug: pattern }];
  }
  const [items, total] = await Promise.all([
    SellerProfile.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({ path: 'userId', select: 'fullName avatar email status role' }),
    SellerProfile.countDocuments(query),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const getSeller = async (id) => {
  const profile = await SellerProfile.findById(id).populate({
    path: 'userId',
    select: 'fullName avatar email status role',
  });
  if (!profile) throw new ApiError(httpStatus.NOT_FOUND, 'Seller not found');
  const [stats, ratingSummary] = await Promise.all([
    Order.aggregate([
      { $match: { sellerId: profile.userId._id } },
      { $group: { _id: '$orderStatus', count: { $sum: 1 }, subtotal: { $sum: '$subtotal' } } },
    ]),
    sellerReputationService.getSellerRatingSummary(profile.userId._id),
  ]);
  return { profile, stats, ratingSummary };
};

const updateSellerStatus = async ({ admin, id, status, reason, req }) => {
  const profile = await SellerProfile.findById(id);
  if (!profile) throw new ApiError(httpStatus.NOT_FOUND, 'Seller not found');
  const before = profile.toObject();
  profile.status = status;
  await profile.save();

  const user = await User.findById(profile.userId);
  if (user) {
    await userService.updateUserStatus({ admin, id: user._id, status, reason, req });
  }

  await auditService.record({
    admin,
    action: `SELLER_${status}`,
    resourceType: 'SELLER',
    resourceId: profile._id,
    reason,
    before,
    after: profile.toObject(),
    req,
  });

  return profile;
};

module.exports = { getSeller, listSellers, updateSellerStatus };
