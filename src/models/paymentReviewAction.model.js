const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  {
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      required: true,
      index: true,
    },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: {
      type: String,
      enum: [
        'WAIT_TOPUP',
        'ACCEPT_PAYMENT',
        'REFUND_UNALLOCATED',
        'REFUND_COMPLETED',
        'REFUND_CANCELLED',
        'PROVIDER_RECHECK',
      ],
      required: true,
    },
    idempotencyKey: { type: String, required: true },
    requestFingerprint: { type: String, required: true },
    note: { type: String, required: true, maxlength: 1000 },
    receivedAmount: Number,
    allocatedAmount: Number,
    adjustmentRefundedAmount: Number,
    amount: { type: Number, default: 0 },
    refundId: { type: mongoose.Schema.Types.ObjectId, ref: 'Refund' },
    before: mongoose.Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
schema.index({ paymentId: 1, idempotencyKey: 1 }, { unique: true });
module.exports = mongoose.model('PaymentReviewAction', schema);
