const mongoose = require('mongoose');
const paymentAttemptStatus = require('../constants/paymentAttemptStatus');

const paymentSchema = new mongoose.Schema(
  {
    checkoutGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CheckoutGroup',
      required: true,
      index: true,
    },
    buyerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    provider: {
      type: String,
      required: true,
      trim: true,
    },
    providerPaymentId: {
      type: String,
      sparse: true,
      index: true,
      trim: true,
    },
    merchantReference: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isInteger,
    },
    currency: {
      type: String,
      enum: ['VND'],
      default: 'VND',
    },
    status: {
      type: String,
      enum: Object.values(paymentAttemptStatus),
      default: paymentAttemptStatus.INITIATED,
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
    paymentUrl: {
      type: String,
      trim: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    paidAt: Date,
    failedAt: Date,
    refundedAmount: {
      type: Number,
      default: 0,
      min: 0,
      validate: Number.isInteger,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
);

paymentSchema.index({ buyerId: 1, idempotencyKey: 1 }, { unique: true });
paymentSchema.index({ provider: 1, providerPaymentId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Payment', paymentSchema);
