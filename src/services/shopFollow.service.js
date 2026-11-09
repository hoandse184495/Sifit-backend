const mongoose = require('mongoose');
const Follow = require('../models/shopFollow.model');
const Shop = require('../models/sellerProfile.model');
const User = require('../models/user.model');
const Product = require('../models/product.model');
const ApiError = require('../utils/ApiError');
const transaction = require('../utils/withTransaction');

const countFollowers = (shopId) => Follow.countDocuments({ shopId, following: true });
const state = async (buyer, shopId) => {
  const follow = await Follow.findOne({ buyerId: buyer._id, shopId });
  return {
    following: Boolean(follow?.following),
    notifyNewProducts: follow?.notifyNewProducts ?? true,
    followerCount: await countFollowers(shopId),
  };
};
const followShop = async (buyer, shopId, data) => {
  await transaction(async (session) => {
    const owner = await User.findOneAndUpdate(
      { _id: buyer._id, role: 'BUYER', status: 'ACTIVE' },
      { $inc: { __v: 1 } },
      { new: true, session },
    );
    if (!owner) throw new ApiError(403, 'Chỉ người mua đang hoạt động được theo dõi shop.');
    const shop = await Shop.findOne({ _id: shopId, status: 'ACTIVE' }).session(session);
    if (
      !shop ||
      !(await User.exists({ _id: shop.userId, role: 'SELLER', status: 'ACTIVE' }).session(session))
    )
      throw new ApiError(404, 'Cửa hàng không còn hoạt động.');
    if (String(shop.userId) === String(buyer._id))
      throw new ApiError(403, 'Bạn không thể theo dõi cửa hàng của chính mình.');
    let follow = await Follow.findOne({ buyerId: buyer._id, shopId }).session(session);
    if (!follow)
      [follow] = await Follow.create(
        [
          {
            buyerId: buyer._id,
            shopId,
            sellerId: shop.userId,
            notifyNewProducts: data.notifyNewProducts ?? true,
          },
        ],
        { session },
      );
    else {
      if (!follow.following) follow.followedAt = new Date();
      follow.following = true;
      if (data.notifyNewProducts !== undefined) follow.notifyNewProducts = data.notifyNewProducts;
      await follow.save({ session });
    }
  });
  return state(buyer, shopId);
};
const unfollowShop = async (buyer, shopId) => {
  await transaction(async (session) => {
    await User.updateOne({ _id: buyer._id }, { $inc: { __v: 1 } }, { session });
    await Follow.updateOne(
      { buyerId: buyer._id, shopId },
      { $set: { following: false } },
      { session },
    );
  });
  return state(buyer, shopId);
};
const updatePreference = async (buyer, shopId, data) => {
  const follow = await Follow.findOneAndUpdate(
    { buyerId: buyer._id, shopId, following: true },
    { $set: { notifyNewProducts: data.notifyNewProducts } },
    { new: true },
  );
  if (!follow) throw new ApiError(409, 'Bạn cần theo dõi shop trước khi thay đổi thông báo.');
  return state(buyer, shopId);
};
const publicFields =
  'userId shopName shopSlug description avatar coverImage verificationStatus status ratingAverage ratingCount totalSales';
const listFollowing = async (buyer, { page = 1, limit = 20 }) => {
  const filter = { buyerId: buyer._id, following: true };
  const [records, total] = await Promise.all([
    Follow.find(filter)
      .sort({ followedAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({
        path: 'shopId',
        select: publicFields,
        transform: (doc, id) =>
          doc || { _id: id, status: 'UNAVAILABLE', shopName: 'Cửa hàng không còn khả dụng' },
      })
      .populate({ path: 'sellerId', select: 'status role' })
      .lean(),
    Follow.countDocuments(filter),
  ]);
  const items = records.map((record) => ({
    id: String(record._id),
    shopId: record.shopId?._id || null,
    followedAt: record.followedAt,
    notifyNewProducts: record.notifyNewProducts,
    available: Boolean(
      record.shopId?.status === 'ACTIVE' &&
      record.sellerId?.status === 'ACTIVE' &&
      record.sellerId?.role === 'SELLER',
    ),
    shop: record.shopId,
    // Keep the original shop reference even if the profile has been removed.
    followId: record._id,
  }));
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};
const feed = async (buyer, { page = 1, limit = 20 }) => {
  const [result] = await Product.aggregate([
    { $match: { status: 'ACTIVE', deletedAt: null } },
    {
      $lookup: {
        from: Follow.collection.name,
        let: { seller: '$sellerId' },
        pipeline: [
          {
            $match: {
              buyerId: new mongoose.Types.ObjectId(buyer._id),
              following: true,
              $expr: { $eq: ['$sellerId', '$$seller'] },
            },
          },
          { $limit: 1 },
        ],
        as: 'follow',
      },
    },
    { $match: { 'follow.0': { $exists: true } } },
    {
      $lookup: {
        from: Shop.collection.name,
        localField: 'sellerId',
        foreignField: 'userId',
        pipeline: [
          { $match: { status: 'ACTIVE' } },
          { $project: { shopName: 1, shopSlug: 1, userId: 1, avatar: 1 } },
        ],
        as: 'shop',
      },
    },
    { $unwind: '$shop' },
    {
      $lookup: {
        from: User.collection.name,
        localField: 'sellerId',
        foreignField: '_id',
        pipeline: [
          { $match: { role: 'SELLER', status: 'ACTIVE' } },
          { $project: { fullName: 1, avatar: 1 } },
        ],
        as: 'owner',
      },
    },
    { $unwind: '$owner' },
    { $set: { sellerId: '$owner' } },
    { $unset: ['follow', 'owner'] },
    {
      $facet: {
        items: [
          { $sort: { approvedAt: -1, createdAt: -1, _id: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
        ],
        count: [{ $count: 'total' }],
      },
    },
  ]);
  const total = result.count[0]?.total || 0;
  return {
    items: result.items,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
};

const fanOutApproval = async ({ productId, shopId, approvedAt }) => {
  const product = await Product.findOne({
    _id: productId,
    status: 'ACTIVE',
    deletedAt: null,
    firstPublishedAt: new Date(approvedAt),
  });
  const shop = await Shop.findOne({ _id: shopId, status: 'ACTIVE' });
  if (
    !product ||
    !shop ||
    !(await User.exists({ _id: shop.userId, status: 'ACTIVE', role: 'SELLER' }))
  )
    return;
  const events = require('./notificationEvent.service');
  const cursor = Follow.find({
    shopId,
    following: true,
    notifyNewProducts: true,
    followedAt: { $lte: new Date(approvedAt) },
  })
    .select('buyerId')
    .cursor();
  for await (const follow of cursor) {
    const key = `followed-product:${product._id}:buyer:${follow.buyerId}`;
    await events.enqueueNotificationEvent({
      eventKey: key,
      type: 'NOTIFICATION_CREATE',
      payload: {
        recipientId: follow.buyerId,
        actorId: product.sellerId,
        type: 'FOLLOWED_SHOP_NEW_PRODUCT',
        title: `${shop.shopName} có sản phẩm mới`.slice(0, 160),
        body: product.title,
        resourceType: 'PRODUCT',
        resourceId: product._id,
        shopId: shop._id,
        sourceApprovedAt: new Date(approvedAt),
        eventKey: key,
      },
    });
  }
};
const canDeliverProductNotification = async (data) => {
  const [follow, product, shop, buyer] = await Promise.all([
    Follow.exists({
      buyerId: data.recipientId,
      shopId: data.shopId,
      following: true,
      notifyNewProducts: true,
      followedAt: { $lte: new Date(data.sourceApprovedAt) },
    }),
    Product.findOne({
      _id: data.resourceId,
      status: 'ACTIVE',
      deletedAt: null,
      firstPublishedAt: new Date(data.sourceApprovedAt),
    }).select('sellerId'),
    Shop.findOne({ _id: data.shopId, status: 'ACTIVE' }).select('userId'),
    User.exists({ _id: data.recipientId, role: 'BUYER', status: 'ACTIVE' }),
  ]);
  return Boolean(
    follow &&
    product &&
    shop &&
    buyer &&
    String(product.sellerId) === String(shop.userId) &&
    (await User.exists({ _id: shop.userId, role: 'SELLER', status: 'ACTIVE' })),
  );
};
module.exports = {
  countFollowers,
  state,
  followShop,
  unfollowShop,
  updatePreference,
  listFollowing,
  feed,
  fanOutApproval,
  canDeliverProductNotification,
};
