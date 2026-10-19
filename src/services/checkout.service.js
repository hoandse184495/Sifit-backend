const mongoose = require('mongoose');
const env = require('../config/env');
const httpStatus = require('../constants/httpStatus');
const orderStatus = require('../constants/orderStatus');
const paymentStatus = require('../constants/paymentStatus');
const Cart = require('../models/cart.model');
const CheckoutGroup = require('../models/checkoutGroup.model');
const Order = require('../models/order.model');
const Product = require('../models/product.model');
const ApiError = require('../utils/ApiError');
const { createRequestFingerprint } = require('../utils/idempotency');
const { calculateCommission } = require('../utils/money');
const notificationEventService = require('./notificationEvent.service');

const getReservationExpiry = () =>
  new Date(Date.now() + env.RESERVATION_EXPIRES_IN_MINUTES * 60 * 1000);

const summarizeCheckoutGroup = async (checkoutGroup) => {
  await checkoutGroup.populate({
    path: 'orderIds',
    select:
      'sellerId items subtotal shippingFee buyerTotal commissionRateBasisPoints commissionAmount sellerProceeds orderStatus paymentStatus reservationExpiresAt createdAt',
    populate: { path: 'sellerId', select: 'fullName avatar' },
  });

  return {
    id: checkoutGroup.id,
    subtotal: checkoutGroup.subtotal,
    shippingFee: checkoutGroup.shippingFee,
    buyerTotal: checkoutGroup.buyerTotal,
    orderStatus: checkoutGroup.orderStatus,
    paymentStatus: checkoutGroup.paymentStatus,
    reservationExpiresAt: checkoutGroup.reservationExpiresAt,
    orders: checkoutGroup.orderIds,
  };
};

const loadExistingIdempotentResult = async ({ buyerId, idempotencyKey, requestFingerprint }) => {
  const existing = await CheckoutGroup.findOne({ buyerId, idempotencyKey });

  if (!existing) {
    return null;
  }

  if (existing.requestFingerprint !== requestFingerprint) {
    throw new ApiError(
      httpStatus.CONFLICT,
      'Idempotency key was already used with a different request',
    );
  }

  return summarizeCheckoutGroup(existing);
};

const validateCheckoutProducts = (buyer, products, cartProductIds) => {
  if (products.length !== cartProductIds.length) {
    throw new ApiError(httpStatus.CONFLICT, 'Some cart products are no longer available');
  }

  products.forEach((product) => {
    if (product.status !== 'ACTIVE' || product.deletedAt) {
      throw new ApiError(httpStatus.CONFLICT, 'Some cart products are no longer available');
    }

    if (product.sellerId._id.equals(buyer._id)) {
      throw new ApiError(httpStatus.FORBIDDEN, 'You cannot purchase your own product');
    }

    if (product.sellerId.status !== 'ACTIVE') {
      throw new ApiError(httpStatus.CONFLICT, 'A seller is currently suspended');
    }
  });
};

const groupProductsBySeller = (products) =>
  products.reduce((groups, product) => {
    const sellerId = String(product.sellerId._id);

    if (!groups.has(sellerId)) {
      groups.set(sellerId, []);
    }

    groups.get(sellerId).push(product);
    return groups;
  }, new Map());

const createCheckout = async ({ buyer, shippingAddress, notes, idempotencyKey }) => {
  const requestFingerprint = createRequestFingerprint({ shippingAddress, notes });
  const existingResult = await loadExistingIdempotentResult({
    buyerId: buyer._id,
    idempotencyKey,
    requestFingerprint,
  });

  if (existingResult) {
    return existingResult;
  }

  const session = await mongoose.startSession();

  try {
    let checkoutGroupId;

    await session.withTransaction(async () => {
      const cart = await Cart.findOne({ userId: buyer._id }).session(session);

      if (!cart || cart.items.length === 0) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Cart is empty');
      }

      const cartProductIds = cart.items.map((item) => item.productId);
      const products = await Product.find({
        _id: { $in: cartProductIds },
        deletedAt: null,
      })
        .populate({ path: 'sellerId', select: 'fullName avatar status' })
        .session(session);

      validateCheckoutProducts(buyer, products, cartProductIds);

      const reservationExpiresAt = getReservationExpiry();
      const subtotal = products.reduce((sum, product) => sum + product.price, 0);
      const checkoutGroups = await CheckoutGroup.create(
        [
          {
            buyerId: buyer._id,
            idempotencyKey,
            requestFingerprint,
            subtotal,
            shippingFee: 0,
            buyerTotal: subtotal,
            orderStatus: orderStatus.PENDING_PAYMENT,
            paymentStatus: paymentStatus.UNPAID,
            reservationExpiresAt,
          },
        ],
        { session },
      );
      const checkoutGroup = checkoutGroups[0];
      checkoutGroupId = checkoutGroup._id;

      for (const product of products) {
        const reservation = await Product.updateOne(
          { _id: product._id, status: 'ACTIVE', deletedAt: null },
          { status: 'RESERVED' },
          { session },
        );

        if (reservation.modifiedCount !== 1) {
          throw new ApiError(httpStatus.CONFLICT, 'A product was already reserved or sold');
        }
      }

      const orders = [];
      const groupedProducts = groupProductsBySeller(products);

      for (const [sellerId, sellerProducts] of groupedProducts.entries()) {
        const sellerSubtotal = sellerProducts.reduce((sum, product) => sum + product.price, 0);
        const commission = calculateCommission(sellerSubtotal);
        const orderDocs = await Order.create(
          [
            {
              buyerId: buyer._id,
              sellerId,
              checkoutGroupId: checkoutGroup._id,
              items: sellerProducts.map((product) => ({
                productId: product._id,
                title: product.title,
                image: product.images[0]?.url,
                price: product.price,
                quantity: 1,
              })),
              shippingAddress,
              notes,
              subtotal: sellerSubtotal,
              shippingFee: 0,
              buyerTotal: sellerSubtotal,
              commissionRateBasisPoints: commission.commissionRateBasisPoints,
              commissionAmount: commission.commissionAmount,
              sellerProceeds: commission.sellerProceeds,
              orderStatus: orderStatus.PENDING_PAYMENT,
              paymentStatus: paymentStatus.UNPAID,
              reservationExpiresAt,
            },
          ],
          { session },
        );

        orders.push(orderDocs[0]._id);
        await notificationEventService.enqueueNotificationEvent(
          {
            eventKey: `order:${orderDocs[0]._id}:created`,
            type: 'NOTIFICATION_CREATE',
            payload: {
              recipientId: sellerId,
              actorId: buyer._id,
              type: 'ORDER_CREATED',
              title: 'New order received',
              body: 'You received a new order',
              resourceType: 'ORDER',
              resourceId: orderDocs[0]._id,
              eventKey: `order:${orderDocs[0]._id}:created`,
            },
          },
          { session },
        );
      }

      checkoutGroup.orderIds = orders;
      await checkoutGroup.save({ session });

      await Cart.updateOne(
        { userId: buyer._id },
        { $pull: { items: { productId: { $in: cartProductIds } } } },
        { session },
      );
    });

    const created = await CheckoutGroup.findById(checkoutGroupId);
    return summarizeCheckoutGroup(created);
  } catch (error) {
    if (error.code === 11000) {
      return loadExistingIdempotentResult({
        buyerId: buyer._id,
        idempotencyKey,
        requestFingerprint,
      });
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

module.exports = {
  createCheckout,
  summarizeCheckoutGroup,
};
