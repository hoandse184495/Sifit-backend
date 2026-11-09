const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  {
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    sellerId: {
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
    amount: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isSafeInteger,
      immutable: true,
    },
    listingPrice: { type: Number, required: true, immutable: true },
    productSnapshot: { title: String, image: String },
    message: { type: String, maxlength: 500 },
    status: {
      type: String,
      enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED', 'CHECKED_OUT'],
      default: 'PENDING',
    },
    open: { type: Boolean, default: true },
    expiresAt: { type: Date, required: true },
    respondedAt: Date,
    responseNote: { type: String, maxlength: 500 },
    checkoutGroupId: { type: mongoose.Schema.Types.ObjectId, ref: 'CheckoutGroup' },
    usedAt: Date,
    idempotencyKey: { type: String, required: true, immutable: true },
    requestFingerprint: { type: String, required: true, immutable: true },
    history: [
      {
        _id: false,
        action: String,
        actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        at: Date,
        note: String,
      },
    ],
  },
  { timestamps: true },
);
schema.index({ buyerId: 1, idempotencyKey: 1 }, { unique: true });
schema.index(
  { buyerId: 1, productId: 1 },
  { unique: true, partialFilterExpression: { open: true } },
);
schema.index({ buyerId: 1, createdAt: -1 });
schema.index({ sellerId: 1, createdAt: -1 });
schema.index({ open: 1, expiresAt: 1 });
module.exports = mongoose.model('Offer', schema);
