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
      enum: ['REQUESTED', 'PENDING', 'APPROVED', 'SUCCEEDED', 'FAILED', 'CANCELLED'],
      default: 'REQUESTED',
      index: true,
    },
    provider: { type: String, required: true },
    providerRefundId: { type: String, sparse: true, index: true },
    idempotencyKey: { type: String, required: true, trim: true },
    reason: { type: String, trim: true },
    kind: {
      type: String,
      enum: ['PROVIDER', 'MANUAL_BANK', 'RECEIPT_ADJUSTMENT'],
      default: 'PROVIDER',
      index: true,
    },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', index: true },
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    relatedSellerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    disputeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dispute' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancelledAt: Date,
    bank: { bankName: String, bankBin: String, accountNumber: String, accountName: String },
    bankSnapshot: { bankName: String, bankBin: String, accountNumber: String, accountName: String },
    transferReference: { type: String, trim: true },
    transferNote: { type: String, trim: true },
    transferredAt: Date,
    allocation: { seller: Number, commission: Number, shipping: Number },
    proof: { mimeType: String, size: Number, sha256: String, uploadedAt: Date },
    auditHistory: [
      { action: String, actorId: mongoose.Schema.Types.ObjectId, at: Date, note: String },
    ],
    completedAt: Date,
    failedAt: Date,
  },
  { timestamps: true },
);

refundSchema.index({ paymentId: 1, idempotencyKey: 1 }, { unique: true });
refundSchema.index(
  { paymentId: 1 },
  {
    name: 'one_active_receipt_adjustment',
    unique: true,
    partialFilterExpression: {
      kind: 'RECEIPT_ADJUSTMENT',
      status: { $in: ['REQUESTED', 'PENDING', 'APPROVED'] },
    },
  },
);
refundSchema.index(
  { orderId: 1 },
  {
    name: 'one_active_manual_refund_per_order',
    unique: true,
    partialFilterExpression: {
      kind: 'MANUAL_BANK',
      status: { $in: ['REQUESTED', 'PENDING', 'APPROVED'] },
    },
  },
);
refundSchema.index(
  { transferReference: 1 },
  { unique: true, partialFilterExpression: { transferReference: { $type: 'string' } } },
);

module.exports = mongoose.model('Refund', refundSchema);
