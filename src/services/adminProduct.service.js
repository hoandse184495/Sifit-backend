const httpStatus = require('../constants/httpStatus');
const Product = require('../models/product.model');
const ApiError = require('../utils/ApiError');
const auditService = require('./adminAudit.service');
const notificationEventService = require('./notificationEvent.service');

const listProducts = async ({ page = 1, limit = 20, status, sellerId, search } = {}) => {
  const filter = {};
  if (status) filter.status = status;
  if (sellerId) filter.sellerId = sellerId;
  if (search) filter.$text = { $search: search };

  const [items, total] = await Promise.all([
    Product.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({ path: 'sellerId', select: 'fullName avatar status' })
      .populate({ path: 'categoryId', select: 'name slug' }),
    Product.countDocuments(filter),
  ]);

  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const listPendingProducts = async ({ page = 1, limit = 20 }) => {
  const filter = {
    status: 'PENDING',
    deletedAt: null,
  };

  const [items, total] = await Promise.all([
    Product.find(filter)
      .sort({ createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({ path: 'sellerId', select: 'fullName avatar' })
      .populate({ path: 'categoryId', select: 'name slug' }),
    Product.countDocuments(filter),
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

const approveProduct = async (id, admin) => {
  const product = await Product.findOneAndUpdate(
    { _id: id, status: 'PENDING', deletedAt: null },
    {
      status: 'ACTIVE',
      approvedAt: new Date(),
      approvedBy: admin._id,
      $unset: { rejectionReason: '' },
    },
    { new: true },
  );

  if (!product) {
    throw new ApiError(httpStatus.CONFLICT, 'Only pending products can be approved');
  }

  await notificationEventService.enqueueNotificationEvent({
    eventKey: `product:${product._id}:approved`,
    type: 'NOTIFICATION_CREATE',
    payload: {
      recipientId: product.sellerId,
      actorId: admin._id,
      type: 'PRODUCT_APPROVED',
      title: 'Product approved',
      body: 'Your product has been approved',
      resourceType: 'PRODUCT',
      resourceId: product._id,
      eventKey: `product:${product._id}:approved`,
    },
  });

  await auditService.record({
    admin,
    action: 'PRODUCT_APPROVED',
    resourceType: 'PRODUCT',
    resourceId: product._id,
    before: { status: 'PENDING' },
    after: product.toObject(),
  });

  return product;
};

const rejectProduct = async (id, reason, admin) => {
  const product = await Product.findOneAndUpdate(
    { _id: id, status: 'PENDING', deletedAt: null },
    {
      status: 'REJECTED',
      rejectionReason: reason,
      $unset: { approvedAt: '', approvedBy: '' },
    },
    { new: true },
  );

  if (!product) {
    throw new ApiError(httpStatus.CONFLICT, 'Only pending products can be rejected');
  }

  await notificationEventService.enqueueNotificationEvent({
    eventKey: `product:${product._id}:rejected`,
    type: 'NOTIFICATION_CREATE',
    payload: {
      recipientId: product.sellerId,
      actorId: admin?._id,
      type: 'PRODUCT_REJECTED',
      title: 'Product rejected',
      body: 'Your product was rejected during moderation',
      resourceType: 'PRODUCT',
      resourceId: product._id,
      eventKey: `product:${product._id}:rejected`,
    },
  });

  await auditService.record({
    admin,
    action: 'PRODUCT_REJECTED',
    resourceType: 'PRODUCT',
    resourceId: product._id,
    reason,
    before: { status: 'PENDING' },
    after: product.toObject(),
  });

  return product;
};

const hideProduct = async (id, reason, admin) => {
  const product = await Product.findOne({
    _id: id,
    status: { $in: ['ACTIVE', 'PENDING', 'REJECTED'] },
    deletedAt: null,
  });

  if (!product) {
    throw new ApiError(httpStatus.CONFLICT, 'Only visible non-sold products can be hidden');
  }

  const before = product.toObject();
  product.status = 'ARCHIVED';
  product.rejectionReason = reason;
  product.hiddenBy = admin._id;
  product.hiddenAt = new Date();
  await product.save();

  await auditService.record({
    admin,
    action: 'PRODUCT_HIDDEN',
    resourceType: 'PRODUCT',
    resourceId: product._id,
    reason,
    before,
    after: product.toObject(),
  });

  return product;
};

module.exports = {
  approveProduct,
  hideProduct,
  listProducts,
  listPendingProducts,
  rejectProduct,
};
