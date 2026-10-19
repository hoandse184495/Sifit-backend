const mongoose = require('mongoose');
const orderStatus = require('../constants/orderStatus');
const paymentStatus = require('../constants/paymentStatus');

const itemSnapshotSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    image: {
      type: String,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    quantity: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
      max: 1,
    },
  },
  { _id: false },
);

const shippingAddressSchema = new mongoose.Schema(
  {
    recipientName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    addressLine: { type: String, required: true, trim: true },
    ward: { type: String, required: true, trim: true },
    district: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    postalCode: { type: String, trim: true },
    notes: { type: String, trim: true },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    buyerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    checkoutGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CheckoutGroup',
      index: true,
    },
    items: {
      type: [itemSnapshotSchema],
      required: true,
      validate: {
        validator(items) {
          return items.length > 0;
        },
        message: 'Order must contain at least one item',
      },
    },
    shippingAddress: {
      type: shippingAddressSchema,
      required: true,
    },
    notes: {
      type: String,
      trim: true,
    },
    subtotal: { type: Number, required: true, min: 0 },
    shippingFee: { type: Number, required: true, min: 0, default: 0 },
    buyerTotal: { type: Number, required: true, min: 0 },
    commissionRateBasisPoints: { type: Number, required: true, min: 0 },
    commissionAmount: { type: Number, required: true, min: 0 },
    sellerProceeds: { type: Number, required: true, min: 0 },
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
    cancelledAt: {
      type: Date,
    },
    deliveredAt: {
      type: Date,
    },
    buyerConfirmedAt: {
      type: Date,
    },
    protectionEndsAt: {
      type: Date,
      index: true,
    },
    completedAt: {
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

orderSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
