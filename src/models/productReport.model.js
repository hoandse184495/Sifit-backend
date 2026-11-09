const mongoose = require('mongoose');

const reasons = ['COUNTERFEIT', 'MISLEADING', 'PROHIBITED', 'INAPPROPRIATE', 'SPAM', 'OTHER'];
const schema = new mongoose.Schema(
  {
    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      immutable: true,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },
    reason: { type: String, enum: reasons, required: true, immutable: true },
    description: {
      type: String,
      trim: true,
      minlength: 10,
      maxlength: 1000,
      required: true,
      immutable: true,
    },
    productSnapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
    status: { type: String, enum: ['OPEN', 'RESOLVED'], default: 'OPEN', required: true },
    decision: { type: String, enum: ['KEEP', 'HIDE'] },
    resolutionNote: { type: String, trim: true, maxlength: 1000 },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: Date,
  },
  { timestamps: true },
);
schema.index(
  { reporterId: 1, productId: 1 },
  { unique: true, partialFilterExpression: { status: 'OPEN' } },
);
schema.index({ reporterId: 1, createdAt: -1 });
schema.index({ status: 1, createdAt: 1 });
module.exports = mongoose.model('ProductReport', schema);
module.exports.reasons = reasons;
