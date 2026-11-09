const httpStatus = require('../constants/httpStatus');
const Product = require('../models/product.model');
const SellerProfile = require('../models/sellerProfile.model');
const ApiError = require('../utils/ApiError');
const slugify = require('../utils/slugify');
const User = require('../models/user.model');
const Category = require('../models/category.model');
const { productSizes, productConditions } = Product;

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

const findPublicProfile = async (filter) => {
  const profile = await SellerProfile.findOne({ ...filter, status: 'ACTIVE' });
  if (!profile || !(await User.exists({ _id: profile.userId, status: 'ACTIVE', role: 'SELLER' })))
    throw new ApiError(httpStatus.NOT_FOUND, 'Shop not found');
  return profile;
};
const getPublicShopBySeller = async (sellerId) => ({
  shop: publicProfile(await findPublicProfile({ userId: sellerId })),
});
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const getShopFacets = async (base) => {
  const [facets] = await Product.aggregate([
    { $match: base },
    {
      $facet: {
        categories: [
          { $group: { _id: '$categoryId', count: { $sum: 1 } } },
          {
            $lookup: {
              from: Category.collection.name,
              localField: '_id',
              foreignField: '_id',
              as: 'category',
            },
          },
          { $unwind: '$category' },
          { $project: { _id: 1, name: '$category.name', count: 1 } },
          { $sort: { name: 1, _id: 1 } },
        ],
        brands: [
          { $match: { brand: { $type: 'string', $ne: '' } } },
          { $group: { _id: '$brand' } },
          { $sort: { _id: 1 } },
        ],
        sizes: [{ $group: { _id: '$size' } }],
        conditions: [{ $group: { _id: '$condition' } }],
        prices: [
          {
            $group: {
              _id: null,
              min: { $min: '$price' },
              max: { $max: '$price' },
              total: { $sum: 1 },
            },
          },
        ],
      },
    },
  ]);
  return {
    categories: facets.categories,
    brands: facets.brands.map((item) => item._id),
    sizes: productSizes.filter((size) => facets.sizes.some((item) => item._id === size)),
    conditions: productConditions.filter((condition) =>
      facets.conditions.some((item) => item._id === condition),
    ),
    minPrice: facets.prices[0]?.min ?? 0,
    maxPrice: facets.prices[0]?.max ?? 0,
    total: facets.prices[0]?.total ?? 0,
  };
};
const getPublicShop = async (slug, { page = 1, limit = 20, sort = 'newest', ...filters } = {}) => {
  const profile = await findPublicProfile({ shopSlug: slug });
  const base = {
    sellerId: profile.userId,
    status: 'ACTIVE',
    deletedAt: null,
  };
  const query = { ...base };
  if (filters.search) {
    const match = new RegExp(escapeRegex(filters.search), 'i');
    query.$or = [{ title: match }, { description: match }, { brand: match }];
  }
  if (filters.categoryId) query.categoryId = filters.categoryId;
  if (filters.brand) query.brand = new RegExp(`^${escapeRegex(filters.brand)}$`, 'i');
  if (filters.size) query.size = filters.size;
  if (filters.condition) query.condition = filters.condition;
  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    query.price = {};
    if (filters.minPrice !== undefined) query.price.$gte = filters.minPrice;
    if (filters.maxPrice !== undefined) query.price.$lte = filters.maxPrice;
  }
  const sorts = {
    newest: { createdAt: -1, _id: -1 },
    oldest: { createdAt: 1, _id: 1 },
    price_asc: { price: 1, _id: 1 },
    price_desc: { price: -1, _id: -1 },
  };
  const [products, total, facets] = await Promise.all([
    Product.find(query)
      .select(
        'sellerId categoryId title description price brand size condition color images status createdAt updatedAt',
      )
      .sort(sorts[sort])
      .skip((page - 1) * limit)
      .limit(limit),
    Product.countDocuments(query),
    getShopFacets(base),
  ]);
  return {
    shop: publicProfile(profile),
    products,
    facets,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
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
  getPublicShopBySeller,
  listPublicShops,
  publicProfile,
  updateProfile,
};
