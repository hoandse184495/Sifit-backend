const mongoose = require('mongoose');

const disputeSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reason: {
      type: String,
      enum: ['ITEM_NOT_RECEIVED', 'ITEM_NOT_AS_DESCRIBED', 'DAMAGED_ITEM', 'WRONG_ITEM', 'OTHER'],
      required: true,
    },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    status: {
      type: String,
      enum: ['OPEN', 'UNDER_REVIEW', 'RESOLVED_BUYER', 'RESOLVED_SELLER', 'CLOSED'],
      default: 'OPEN',
      index: true,
    },
    evidence: [{ type: String, trim: true }],
    evidenceCount: { type: Number, default: 0 },
    messageCount: { type: Number, default: 0 },
    contentVersion: { type: Number, default: 0 },
    returnFlow: {
      required: { type: Boolean, default: false },
      status: {
        type: String,
        enum: ['NOT_REQUIRED', 'AWAITING_SHIPMENT', 'SHIPPED', 'SELLER_RECEIVED', 'VERIFIED'],
        default: 'NOT_REQUIRED',
      },
      address: {
        recipientName: String,
        phone: String,
        addressLine: String,
        ward: String,
        province: String,
      },
      instructions: String,
      shippingPayer: { type: String, enum: ['BUYER', 'SELLER'] },
      shipBy: Date,
      requestedAt: Date,
      requestedBy: mongoose.Schema.Types.ObjectId,
      shipment: {
        carrierName: String,
        trackingNumber: String,
        trackingUrl: String,
        shippedAt: Date,
        note: String,
        submittedAt: Date,
      },
      sellerReceipt: {
        receivedAt: Date,
        confirmedBy: mongoose.Schema.Types.ObjectId,
        note: String,
      },
      verification: {
        verifiedAt: Date,
        adminId: mongoose.Schema.Types.ObjectId,
        note: String,
        overrideSellerConfirmation: Boolean,
      },
    },
    openedAt: { type: Date, default: Date.now },
    resolvedAt: Date,
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolution: { type: String, trim: true },
    refundSettledAt: Date,
    refundId: { type: mongoose.Schema.Types.ObjectId, ref: 'Refund' },
    auditHistory: [
      {
        action: String,
        actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        at: { type: Date, default: Date.now },
        note: String,
      },
    ],
  },
  { timestamps: true },
);

disputeSchema.index(
  { orderId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['OPEN', 'UNDER_REVIEW'] } } },
);

module.exports = mongoose.model('Dispute', disputeSchema);
