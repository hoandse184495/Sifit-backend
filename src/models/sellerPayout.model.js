const mongoose = require('mongoose');
const payoutStatus = require('../constants/payoutStatus');

const sellerPayoutSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orderIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Order' }],
    verificationId: { type: mongoose.Schema.Types.ObjectId, ref: 'SellerVerification' },
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
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    transferReference: { type: String, trim: true, maxlength: 100 },
    transferNote: { type: String, trim: true, maxlength: 1000 },
    bankSnapshot: { bankName: String, bankBin: String, accountNumber: String, accountName: String },
    failureReason: { type: String, trim: true },
    refundAdjustments: [{ refundId: mongoose.Schema.Types.ObjectId, amount: Number, at: Date }],
  },
  { timestamps: true },
);

sellerPayoutSchema.index({ sellerId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });
sellerPayoutSchema.index(
  { provider: 1, transferReference: 1 },
  { unique: true, partialFilterExpression: { transferReference: { $type: 'string' } } },
);

module.exports = mongoose.model('SellerPayout', sellerPayoutSchema);
