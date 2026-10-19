const mongoose = require('mongoose');
const orderStatus = require('../constants/orderStatus');
const paymentStatus = require('../constants/paymentStatus');
const CheckoutGroup = require('../models/checkoutGroup.model');
const Order = require('../models/order.model');
const Product = require('../models/product.model');

const expireReservations = async ({ now = new Date(), limit = 20 } = {}) => {
  const expiredGroups = await CheckoutGroup.find({
    orderStatus: orderStatus.PENDING_PAYMENT,
    paymentStatus: paymentStatus.UNPAID,
    reservationExpiresAt: { $lte: now },
    $or: [{ expiryLeaseExpiresAt: { $exists: false } }, { expiryLeaseExpiresAt: { $lte: now } }],
  })
    .sort({ reservationExpiresAt: 1 })
    .limit(limit);

  let expiredCount = 0;

  for (const group of expiredGroups) {
    const lease = await CheckoutGroup.findOneAndUpdate(
      {
        _id: group._id,
        orderStatus: orderStatus.PENDING_PAYMENT,
        paymentStatus: paymentStatus.UNPAID,
        reservationExpiresAt: { $lte: now },
        $or: [
          { expiryLeaseExpiresAt: { $exists: false } },
          { expiryLeaseExpiresAt: { $lte: now } },
        ],
      },
      {
        expiryClaimedAt: now,
        expiryLeaseExpiresAt: new Date(now.getTime() + 60 * 1000),
      },
      { new: true },
    );

    if (!lease) continue;

    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        const orders = await Order.find({
          checkoutGroupId: lease._id,
          orderStatus: orderStatus.PENDING_PAYMENT,
          paymentStatus: paymentStatus.UNPAID,
        }).session(session);

        const productIds = orders.flatMap((order) => order.items.map((item) => item.productId));

        await Product.updateMany(
          { _id: { $in: productIds }, status: 'RESERVED' },
          { status: 'ACTIVE' },
          { session },
        );

        await Order.updateMany(
          {
            checkoutGroupId: lease._id,
            orderStatus: orderStatus.PENDING_PAYMENT,
            paymentStatus: paymentStatus.UNPAID,
          },
          {
            orderStatus: orderStatus.CANCELLED,
            cancelledAt: now,
            cancellationReason: 'reservation_expired',
          },
          { session },
        );

        await CheckoutGroup.updateOne(
          {
            _id: lease._id,
            orderStatus: orderStatus.PENDING_PAYMENT,
            paymentStatus: paymentStatus.UNPAID,
          },
          {
            orderStatus: orderStatus.CANCELLED,
            cancelledAt: now,
            cancellationReason: 'reservation_expired',
            expiryLeaseExpiresAt: now,
          },
          { session },
        );
      });

      expiredCount += 1;
    } finally {
      await session.endSession();
    }
  }

  return { expiredCount };
};

module.exports = {
  expireReservations,
};
