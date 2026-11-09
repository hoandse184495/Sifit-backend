const Offer = require('../models/offer.model');
const Product = require('../models/product.model');
const User = require('../models/user.model');
const Shop = require('../models/sellerProfile.model');
const ApiError = require('../utils/ApiError');
const transaction = require('../utils/withTransaction');
const { createRequestFingerprint } = require('../utils/idempotency');
const events = require('./notificationEvent.service');
const flush = require('../utils/flushNotifications');
const DAY = 24 * 60 * 60 * 1000;

const queue = async (offer, action, session) => {
  const both = ['EXPIRED', 'WITHDRAWN'].includes(action);
  const recipients = both
    ? [offer.buyerId, offer.sellerId]
    : [action === 'CREATED' ? offer.sellerId : offer.buyerId];
  const labels = {
    CREATED: 'Bạn có đề nghị giá mới',
    ACCEPTED: 'Đề nghị giá đã được chấp nhận',
    REJECTED: 'Đề nghị giá bị từ chối',
    WITHDRAWN: 'Đề nghị giá đã được rút',
    EXPIRED: 'Đề nghị giá đã hết hạn',
  };
  for (const recipientId of recipients) {
    const key = `offer:${offer._id}:${action}:${recipientId}`;
    await events.enqueueNotificationEvent(
      {
        eventKey: key,
        type: 'NOTIFICATION_CREATE',
        payload: {
          recipientId,
          type: 'OFFER_UPDATED',
          title: labels[action],
          body: `${offer.productSnapshot.title} · ${offer.amount.toLocaleString('vi-VN')} đ`.slice(
            0,
            500,
          ),
          resourceType: 'OFFER',
          resourceId: offer._id,
          eventKey: key,
        },
      },
      { session },
    );
  }
};
const expireOne = async (id, now, session) => {
  const offer = await Offer.findOneAndUpdate(
    { _id: id, open: true, expiresAt: { $lte: now } },
    {
      $set: { status: 'EXPIRED', open: false },
      $push: { history: { action: 'EXPIRED', at: now } },
    },
    { new: true, session },
  );
  if (offer) await queue(offer, 'EXPIRED', session);
  return offer;
};
const activeProduct = async (id, session) => {
  const product = await Product.findOneAndUpdate(
    { _id: id, status: 'ACTIVE', deletedAt: null },
    { $inc: { __v: 1 } },
    { new: true, session },
  );
  if (!product)
    throw new ApiError(409, 'Sản phẩm đang được giữ chỗ, đã bán hoặc không còn khả dụng.');
  if (
    !(await User.exists({ _id: product.sellerId, role: 'SELLER', status: 'ACTIVE' }).session(
      session,
    )) ||
    (await Shop.exists({ userId: product.sellerId, status: 'SUSPENDED' }).session(session))
  )
    throw new ApiError(409, 'Cửa hàng hiện không khả dụng.');
  return product;
};
const createOffer = async (buyer, productId, data) => {
  const fingerprint = createRequestFingerprint({
    productId: String(productId).toLowerCase(),
    amount: data.amount,
    message: data.message || '',
  });
  let offer;
  try {
    offer = await transaction(async (session) => {
      if (
        !(await User.findOneAndUpdate(
          { _id: buyer._id, role: 'BUYER', status: 'ACTIVE' },
          { $inc: { __v: 1 } },
          { session },
        ))
      )
        throw new ApiError(403, 'Chỉ người mua đang hoạt động được gửi đề nghị.');
      const existing = await Offer.findOne({
        buyerId: buyer._id,
        idempotencyKey: data.idempotencyKey,
      }).session(session);
      if (existing) {
        if (existing.requestFingerprint !== fingerprint)
          throw new ApiError(409, 'Mã yêu cầu đã được dùng cho đề nghị khác.');
        return existing;
      }
      const now = new Date();
      const old = await Offer.find({
        buyerId: buyer._id,
        productId,
        open: true,
        expiresAt: { $lte: now },
      }).session(session);
      for (const item of old) await expireOne(item._id, now, session);
      if (await Offer.exists({ buyerId: buyer._id, productId, open: true }).session(session))
        throw new ApiError(
          409,
          'Bạn đã có đề nghị đang chờ hoặc đã được chấp nhận cho sản phẩm này.',
        );
      const product = await activeProduct(productId, session);
      if (String(product.sellerId) === String(buyer._id))
        throw new ApiError(403, 'Bạn không thể mặc cả sản phẩm của mình.');
      if (data.amount >= product.price)
        throw new ApiError(400, 'Giá đề nghị phải thấp hơn giá niêm yết.');
      const recent = { buyerId: buyer._id, createdAt: { $gt: new Date(now.getTime() - DAY) } };
      if ((await Offer.countDocuments(recent).session(session)) >= 10)
        throw new ApiError(429, 'Bạn đã gửi 10 đề nghị trong 24 giờ. Vui lòng thử lại sau.');
      if ((await Offer.countDocuments({ ...recent, productId }).session(session)) >= 3)
        throw new ApiError(429, 'Mỗi sản phẩm chỉ nhận tối đa 3 đề nghị của bạn trong 24 giờ.');
      const [created] = await Offer.create(
        [
          {
            buyerId: buyer._id,
            sellerId: product.sellerId,
            productId,
            amount: data.amount,
            message: data.message,
            listingPrice: product.price,
            productSnapshot: { title: product.title, image: product.images[0]?.url },
            idempotencyKey: data.idempotencyKey,
            requestFingerprint: fingerprint,
            expiresAt: new Date(now.getTime() + DAY),
            history: [{ action: 'CREATED', actorId: buyer._id, at: now }],
          },
        ],
        { session },
      );
      await queue(created, 'CREATED', session);
      return created;
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    offer = await Offer.findOne({ buyerId: buyer._id, idempotencyKey: data.idempotencyKey });
    if (!offer || offer.requestFingerprint !== fingerprint)
      throw new ApiError(409, 'Đề nghị bị trùng. Vui lòng tải lại danh sách.');
  }
  await flush([offer._id]);
  return getOffer(buyer, offer._id);
};

const respond = async (seller, id, data) => {
  const offer = await transaction(async (session) => {
    const initial = await Offer.findOne({ _id: id, sellerId: seller._id }).session(session);
    if (!initial) throw new ApiError(404, 'Không tìm thấy đề nghị của shop.');
    const product = await activeProduct(initial.productId, session);
    if (String(product.sellerId) !== String(seller._id) || product.price !== initial.listingPrice)
      throw new ApiError(409, 'Sản phẩm đã thay đổi. Người mua cần gửi lại đề nghị.');
    if (
      !(await User.exists({ _id: initial.buyerId, status: 'ACTIVE', role: 'BUYER' }).session(
        session,
      ))
    )
      throw new ApiError(409, 'Người mua không còn hoạt động.');
    const now = new Date();
    const status = data.decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';
    const updated = await Offer.findOneAndUpdate(
      { _id: id, sellerId: seller._id, status: 'PENDING', open: true, expiresAt: { $gt: now } },
      {
        $set: {
          status,
          open: status === 'ACCEPTED',
          respondedAt: now,
          responseNote: data.note || '',
          ...(status === 'ACCEPTED' ? { expiresAt: new Date(now.getTime() + DAY) } : {}),
        },
        $push: { history: { action: status, actorId: seller._id, at: now, note: data.note } },
      },
      { new: true, session },
    );
    if (!updated) throw new ApiError(409, 'Đề nghị đã được xử lý hoặc hết hạn.');
    await queue(updated, status, session);
    return updated;
  });
  await flush([offer._id]);
  return getOffer(seller, id);
};
const withdraw = async (buyer, id) => {
  await transaction(async (session) => {
    const offer = await Offer.findOneAndUpdate(
      { _id: id, buyerId: buyer._id, open: true, expiresAt: { $gt: new Date() } },
      {
        $set: { status: 'WITHDRAWN', open: false },
        $push: { history: { action: 'WITHDRAWN', actorId: buyer._id, at: new Date() } },
      },
      { new: true, session },
    );
    if (!offer) throw new ApiError(409, 'Đề nghị đã được xử lý hoặc hết hạn.');
    await queue(offer, 'WITHDRAWN', session);
  });
  await flush([id]);
  return getOffer(buyer, id);
};

const present = (offer) => {
  const product = offer.productId;
  const expired = offer.open && offer.expiresAt <= new Date();
  const available = Boolean(
    product?.status === 'ACTIVE' &&
    !product.deletedAt &&
    product.price === offer.listingPrice &&
    offer.buyerId?.status === 'ACTIVE' &&
    offer.sellerId?.status === 'ACTIVE',
  );
  return {
    ...offer,
    effectiveStatus: expired ? 'EXPIRED' : offer.status,
    available,
    actionable: offer.open && !expired && available,
  };
};
const populate = (query) =>
  query
    .populate({ path: 'productId', select: 'title images price status deletedAt sellerId' })
    .populate({ path: 'buyerId sellerId', select: 'fullName avatar status' });
const presentMany = async (items) => {
  const blocked = await Shop.find({
    userId: { $in: items.map((item) => item.sellerId?._id).filter(Boolean) },
    status: 'SUSPENDED',
  })
    .select('userId')
    .lean();
  const ids = new Set(blocked.map((shop) => String(shop.userId)));
  return items.map((item) => {
    const visible = { ...item };
    delete visible.requestFingerprint;
    delete visible.idempotencyKey;
    const result = present(visible);
    if (ids.has(String(item.sellerId?._id))) {
      result.available = false;
      result.actionable = false;
    }
    return result;
  });
};
const getOffer = async (user, id) => {
  const offer = await populate(
    Offer.findOne({ _id: id, [user.role === 'SELLER' ? 'sellerId' : 'buyerId']: user._id }),
  ).lean();
  if (!offer) throw new ApiError(404, 'Không tìm thấy đề nghị hoặc bạn không có quyền xem.');
  return (await presentMany([offer]))[0];
};
const list = async (user, { page = 1, limit = 20, status, productId }) => {
  const query = {
    [user.role === 'SELLER' ? 'sellerId' : 'buyerId']: user._id,
    ...(productId ? { productId } : {}),
  };
  if (status === 'EXPIRED')
    query.$or = [{ status: 'EXPIRED' }, { open: true, expiresAt: { $lte: new Date() } }];
  else if (status) {
    query.status = status;
    if (['PENDING', 'ACCEPTED'].includes(status)) query.expiresAt = { $gt: new Date() };
  }
  const [items, total] = await Promise.all([
    populate(
      Offer.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ).lean(),
    Offer.countDocuments(query),
  ]);
  return {
    items: await presentMany(items),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
};

const checkoutOffers = async ({ buyer, products, offerIds, session }) => {
  const offers = await Offer.find({
    _id: { $in: offerIds },
    buyerId: buyer._id,
    status: 'ACCEPTED',
    open: true,
    expiresAt: { $gt: new Date() },
  }).session(session);
  if (offers.length !== offerIds.length)
    throw new ApiError(409, 'Đề nghị không hợp lệ, đã hết hạn hoặc không thuộc tài khoản của bạn.');
  const byProduct = new Map();
  for (const offer of offers) {
    const product = products.find((item) => String(item._id) === String(offer.productId));
    if (
      !product ||
      String(product.sellerId._id) !== String(offer.sellerId) ||
      product.price !== offer.listingPrice ||
      byProduct.has(String(product._id))
    )
      throw new ApiError(
        409,
        'Đề nghị không khớp sản phẩm trong giỏ hàng. Hãy tải lại và kiểm tra.',
      );
    if (await Shop.exists({ userId: offer.sellerId, status: 'SUSPENDED' }).session(session))
      throw new ApiError(409, 'Cửa hàng hiện không khả dụng.');
    if (
      !(await User.exists({ _id: offer.sellerId, role: 'SELLER', status: 'ACTIVE' }).session(
        session,
      ))
    )
      throw new ApiError(409, 'Người bán hiện không khả dụng.');
    byProduct.set(String(product._id), offer);
  }
  return byProduct;
};
const consume = async (offers, groupId, session) => {
  for (const offer of offers.values()) {
    const result = await Offer.updateOne(
      { _id: offer._id, status: 'ACCEPTED', open: true, expiresAt: { $gt: new Date() } },
      {
        $set: { status: 'CHECKED_OUT', open: false, checkoutGroupId: groupId, usedAt: new Date() },
        $push: { history: { action: 'CHECKED_OUT', actorId: offer.buyerId, at: new Date() } },
      },
      { session },
    );
    if (result.modifiedCount !== 1)
      throw new ApiError(409, 'Đề nghị vừa thay đổi hoặc hết hạn. Vui lòng kiểm tra lại.');
  }
};
const expireOffers = async ({ now = new Date(), limit = 20 } = {}) => {
  const due = await Offer.find({ open: true, expiresAt: { $lte: now } })
    .sort({ expiresAt: 1 })
    .limit(limit)
    .select('_id');
  let expiredCount = 0;
  for (const item of due)
    if (await transaction((session) => expireOne(item._id, now, session))) expiredCount += 1;
  return { expiredCount };
};
module.exports = {
  createOffer,
  respond,
  withdraw,
  getOffer,
  list,
  checkoutOffers,
  consume,
  expireOffers,
};
