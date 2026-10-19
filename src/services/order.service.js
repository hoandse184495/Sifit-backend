const mongoose = require('mongoose');
const httpStatus = require('../constants/httpStatus');
const orderStatus = require('../constants/orderStatus');
const paymentStatus = require('../constants/paymentStatus');
const roles = require('../constants/roles');
const CheckoutGroup = require('../models/checkoutGroup.model');
const Order = require('../models/order.model');
const Product = require('../models/product.model');
const ApiError = require('../utils/ApiError');
const notificationEventService = require('./notificationEvent.service');
const Dispute = require('../models/dispute.model');
const SellerRating = require('../models/sellerRating.model');
const ProductReview = require('../models/productReview.model');
const { ownReviewDetails } = require('./productReview.service');
const { getDisputeEligibility } = require('./disputePolicy');

const withBuyerDetails = async (orders) => {
  const ids = orders.map((order) => order._id);
  const [disputes, ratings, reviews] = await Promise.all([
    Dispute.find({ orderId: { $in: ids }, status: { $in: ['OPEN', 'UNDER_REVIEW'] } })
      .select('orderId status reason')
      .lean(),
    SellerRating.find({ orderId: { $in: ids } })
      .select('orderId rating comment status createdAt')
      .lean(),
    ProductReview.find({ orderId: { $in: ids } }),
  ]);
  return orders.map((order) => {
    const activeDispute = disputes.find((item) => String(item.orderId) === String(order._id));
    const eligibility = getDisputeEligibility(order);
    return {
      ...order.toObject(),
      disputeEligibility: { ...eligibility, eligible: eligibility.eligible && !activeDispute },
      activeDispute: activeDispute || null,
      sellerRating: ratings.find((item) => String(item.orderId) === String(order._id)) || null,
      productReviews: reviews
        .filter((item) => String(item.orderId) === String(order._id))
        .map(ownReviewDetails),
    };
  });
};

const getPagination = ({ page = 1, limit = 20 }) => ({
  page: Number(page),
  limit: Number(limit),
});

const listBuyerOrders = async (user, filters) => {
  const { page, limit } = getPagination(filters);
  const query = { buyerId: user._id };

  if (filters.status) query.orderStatus = filters.status;

  const [items, total] = await Promise.all([
    Order.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({ path: 'sellerId', select: 'fullName avatar' }),
    Order.countDocuments(query),
  ]);

  return {
    items: await withBuyerDetails(items),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
};

const listSellerOrders = async (user, filters) => {
  const { page, limit } = getPagination(filters);
  const query = { sellerId: user._id };

  if (filters.status) query.orderStatus = filters.status;

  const [items, total] = await Promise.all([
    Order.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({ path: 'buyerId', select: 'fullName avatar' }),
    Order.countDocuments(query),
  ]);

  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const listAdminOrders = async (filters) => {
  const { page, limit } = getPagination(filters);
  const query = {};

  if (filters.status) query.orderStatus = filters.status;
  if (filters.search) {
    query._id = mongoose.Types.ObjectId.isValid(filters.search) ? filters.search : undefined;
  }
  if (filters.buyerId) query.buyerId = filters.buyerId;
  if (filters.sellerId) query.sellerId = filters.sellerId;
  if (filters.startDate || filters.endDate) {
    query.createdAt = {};
    if (filters.startDate) query.createdAt.$gte = filters.startDate;
    if (filters.endDate) query.createdAt.$lte = filters.endDate;
  }

  Object.keys(query).forEach((key) => query[key] === undefined && delete query[key]);

  const [items, total] = await Promise.all([
    Order.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({ path: 'buyerId', select: 'fullName avatar' })
      .populate({ path: 'sellerId', select: 'fullName avatar' }),
    Order.countDocuments(query),
  ]);

  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const getOrderById = async (id, user) => {
  const order = await Order.findById(id)
    .populate({ path: 'buyerId', select: 'fullName avatar' })
    .populate({ path: 'sellerId', select: 'fullName avatar' });

  if (!order) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  }

  const canAccess =
    user.role === roles.ADMIN ||
    order.buyerId._id.equals(user._id) ||
    order.sellerId._id.equals(user._id);

  if (!canAccess) {
    throw new ApiError(httpStatus.FORBIDDEN, 'You do not have permission to access this order');
  }

  if (String(order.buyerId._id) === String(user._id)) {
    return (await withBuyerDetails([order]))[0];
  }
  return order;
};

const cancelOrder = async (id, user, reason = 'buyer_cancelled') => {
  const session = await mongoose.startSession();

  try {
    let cancelledOrder;

    await session.withTransaction(async () => {
      const order = await Order.findById(id).session(session);

      if (!order) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
      }

      const canCancel = user.role === roles.ADMIN || order.buyerId.equals(user._id);

      if (!canCancel) {
        throw new ApiError(httpStatus.FORBIDDEN, 'You do not have permission to cancel this order');
      }

      if (
        order.paymentStatus !== paymentStatus.UNPAID ||
        order.orderStatus !== orderStatus.PENDING_PAYMENT
      ) {
        throw new ApiError(httpStatus.CONFLICT, 'Only unpaid pending orders can be cancelled');
      }

      const groupOrders = await Order.find({ checkoutGroupId: order.checkoutGroupId }).session(
        session,
      );
      const productIds = groupOrders.flatMap((groupOrder) =>
        groupOrder.items.map((item) => item.productId),
      );

      await Product.updateMany(
        { _id: { $in: productIds }, status: 'RESERVED' },
        { status: 'ACTIVE' },
        { session },
      );

      await Order.updateMany(
        {
          checkoutGroupId: order.checkoutGroupId,
          paymentStatus: paymentStatus.UNPAID,
          orderStatus: orderStatus.PENDING_PAYMENT,
        },
        {
          orderStatus: orderStatus.CANCELLED,
          cancelledAt: new Date(),
          cancellationReason: reason,
        },
        { session },
      );

      await CheckoutGroup.updateOne(
        {
          _id: order.checkoutGroupId,
          paymentStatus: paymentStatus.UNPAID,
          orderStatus: orderStatus.PENDING_PAYMENT,
        },
        {
          orderStatus: orderStatus.CANCELLED,
          cancelledAt: new Date(),
          cancellationReason: reason,
        },
        { session },
      );

      await Promise.all(
        groupOrders.map((groupOrder) =>
          Promise.all([
            notificationEventService.enqueueNotificationEvent(
              {
                eventKey: `order:${groupOrder._id}:cancelled:buyer`,
                type: 'NOTIFICATION_CREATE',
                payload: {
                  recipientId: groupOrder.buyerId,
                  actorId: user._id,
                  type: 'ORDER_CANCELLED',
                  title: 'Order cancelled',
                  body: 'An order was cancelled',
                  resourceType: 'ORDER',
                  resourceId: groupOrder._id,
                  eventKey: `order:${groupOrder._id}:cancelled`,
                },
              },
              { session },
            ),
            notificationEventService.enqueueNotificationEvent(
              {
                eventKey: `order:${groupOrder._id}:cancelled:seller`,
                type: 'NOTIFICATION_CREATE',
                payload: {
                  recipientId: groupOrder.sellerId,
                  actorId: user._id,
                  type: 'ORDER_CANCELLED',
                  title: 'Order cancelled',
                  body: 'An order was cancelled',
                  resourceType: 'ORDER',
                  resourceId: groupOrder._id,
                  eventKey: `order:${groupOrder._id}:cancelled`,
                },
              },
              { session },
            ),
          ]),
        ),
      );

      cancelledOrder = await Order.findById(id).session(session);
    });

    return cancelledOrder;
  } finally {
    await session.endSession();
  }
};

module.exports = {
  cancelOrder,
  getOrderById,
  listAdminOrders,
  listBuyerOrders,
  listSellerOrders,
};
