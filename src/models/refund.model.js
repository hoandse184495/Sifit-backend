const mongoose = require('mongoose');

const refundSchema = new mongoose.Schema(
  {
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      required: true,
      index: true,
    },
    checkoutGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CheckoutGroup',
      required: true,
      index: true,
    },
    amount: { type: Number, required: true, min: 1, validate: Number.isInteger },
    currency: { type: String, enum: ['VND'], default: 'VND' },
    status: {
      type: String,
      enum: ['REQUESTED', 'PENDING', 'SUCCEEDED', 'FAILED'],
      default: 'REQUESTED',
      index: true,
    },
    provider: { type: String, required: true },
    providerRefundId: { type: String, sparse: true, index: true },
    idempotencyKey: { type: String, required: true, trim: true },
    reason: { type: String, trim: true },
    completedAt: Date,
    failedAt: Date,
  },
  { timestamps: true },
);

refundSchema.index({ paymentId: 1, idempotencyKey: 1 }, { unique: true });

module.exports = mongoose.model('Refund', refundSchema);
