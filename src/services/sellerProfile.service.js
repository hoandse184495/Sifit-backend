const httpStatus = require('../constants/httpStatus');
const Product = require('../models/product.model');
const SellerProfile = require('../models/sellerProfile.model');
const ApiError = require('../utils/ApiError');
const slugify = require('../utils/slugify');

const publicProfile = (profile) => ({
  id: profile.id,
  userId: profile.userId,
  shopName: profile.shopName,
  shopSlug: profile.shopSlug,
  description: profile.description,
  avatar: profile.avatar,
  coverImage: profile.coverImage,
  verificationStatus: profile.verificationStatus,
  status: profile.status,
  totalSales: profile.totalSales,
  ratingAverage: profile.ratingAverage,
  ratingCount: profile.ratingCount,
});

const createProfile = async (user, data) => {
  const existing = await SellerProfile.exists({ userId: user._id });
  if (existing) throw new ApiError(httpStatus.CONFLICT, 'Seller profile already exists');

  const shopSlug = slugify(data.shopName);
  const profile = await SellerProfile.create({ ...data, userId: user._id, shopSlug });
  return publicProfile(profile);
};

const getOwnProfile = async (user) => {
  const profile = await SellerProfile.findOne({ userId: user._id });
  if (!profile) throw new ApiError(httpStatus.NOT_FOUND, 'Seller profile not found');
  return profile;
};

const updateProfile = async (user, data) => {
  const profile = await getOwnProfile(user);
  ['shopName', 'description', 'avatar', 'coverImage', 'contactPhone'].forEach((field) => {
    if (data[field] !== undefined) profile[field] = data[field];
  });
  if (data.shopName) profile.shopSlug = slugify(data.shopName);
  await profile.save();
  return publicProfile(profile);
};

const getPublicShop = async (slug) => {
  const profile = await SellerProfile.findOne({ shopSlug: slug, status: 'ACTIVE' });
  if (!profile) throw new ApiError(httpStatus.NOT_FOUND, 'Shop not found');
  const products = await Product.find({
    sellerId: profile.userId,
    status: 'ACTIVE',
    deletedAt: null,
  })
    .sort({ createdAt: -1 })
    .limit(20);
  return { shop: publicProfile(profile), products };
};

const listPublicShops = async ({ page = 1, limit = 20, search }) => {
  const query = { status: 'ACTIVE' };
  if (search) query.shopName = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const [items, total] = await Promise.all([
    SellerProfile.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    SellerProfile.countDocuments(query),
  ]);
  return {
    items: items.map(publicProfile),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
};

module.exports = {
  createProfile,
  getOwnProfile,
  getPublicShop,
  listPublicShops,
  publicProfile,
  updateProfile,
};
