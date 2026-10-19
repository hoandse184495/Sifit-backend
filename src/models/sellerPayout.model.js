const mongoose = require('mongoose');
const payoutStatus = require('../constants/payoutStatus');

const sellerPayoutSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orderIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Order' }],
    amount: { type: Number, required: true, min: 0, validate: Number.isInteger },
    currency: { type: String, enum: ['VND'], default: 'VND' },
    status: {
      type: String,
      enum: Object.values(payoutStatus),
      default: payoutStatus.PENDING,
      index: true,
    },
    provider: { type: String, default: 'simulator' },
    providerPayoutId: { type: String, sparse: true, index: true },
    idempotencyKey: { type: String, trim: true },
    requestedAt: Date,
    approvedAt: Date,
    processedAt: Date,
    completedAt: Date,
    failureReason: { type: String, trim: true },
  },
  { timestamps: true },
);

sellerPayoutSchema.index({ sellerId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('SellerPayout', sellerPayoutSchema);
