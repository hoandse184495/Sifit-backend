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
    openedAt: { type: Date, default: Date.now },
    resolvedAt: Date,
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolution: { type: String, trim: true },
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
