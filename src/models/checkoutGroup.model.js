const mongoose = require('mongoose');
const orderStatus = require('../constants/orderStatus');
const paymentStatus = require('../constants/paymentStatus');

const checkoutGroupSchema = new mongoose.Schema(
  {
    buyerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
    },
    requestFingerprint: {
      type: String,
      required: true,
    },
    orderIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
      },
    ],
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    shippingFee: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    buyerTotal: {
      type: Number,
      required: true,
      min: 0,
    },
    orderStatus: {
      type: String,
      enum: Object.values(orderStatus),
      default: orderStatus.PENDING_PAYMENT,
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: Object.values(paymentStatus),
      default: paymentStatus.UNPAID,
      index: true,
    },
    reservationExpiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    expiryClaimedAt: {
      type: Date,
    },
    expiryLeaseExpiresAt: {
      type: Date,
    },
    cancelledAt: {
      type: Date,
    },
    cancellationReason: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

checkoutGroupSchema.index({ buyerId: 1, idempotencyKey: 1 }, { unique: true });

module.exports = mongoose.model('CheckoutGroup', checkoutGroupSchema);
