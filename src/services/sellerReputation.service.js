const httpStatus = require('../constants/httpStatus');
const SellerProfile = require('../models/sellerProfile.model');
const SellerRating = require('../models/sellerRating.model');
const ApiError = require('../utils/ApiError');
const { emptyDistribution } = require('../utils/ratingCalculator');

const getSellerRatingSummary = async (sellerId) => {
  const aggregation = await SellerRating.aggregate([
    { $match: { sellerId, status: 'PUBLISHED' } },
    { $group: { _id: '$rating', count: { $sum: 1 } } },
  ]);
  const distribution = emptyDistribution();
  let total = 0;
  let weighted = 0;
  aggregation.forEach((item) => {
    distribution[item._id] = item.count;
    total += item.count;
    weighted += item._id * item.count;
  });
  const ratingAverage = total === 0 ? 0 : Math.round((weighted / total) * 10) / 10;
  return { ratingAverage, ratingCount: total, distribution };
};

const rebuildSellerStats = async (sellerId) => {
  const summary = await getSellerRatingSummary(sellerId);
  await SellerProfile.updateOne(
    { userId: sellerId },
    { ratingAverage: summary.ratingAverage, ratingCount: summary.ratingCount },
  );
  return summary;
};

const getShopRatingSummary = async (slug) => {
  const profile = await SellerProfile.findOne({ shopSlug: slug, status: 'ACTIVE' });
  if (!profile) throw new ApiError(httpStatus.NOT_FOUND, 'Shop not found');

  return getSellerRatingSummary(profile.userId);
};

module.exports = { getSellerRatingSummary, getShopRatingSummary, rebuildSellerStats };
