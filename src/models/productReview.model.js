const mongoose = require('mongoose');

const reviewImageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    publicId: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const productReviewSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: Number.isInteger,
      index: true,
    },
    title: { type: String, trim: true, maxlength: 150 },
    comment: { type: String, trim: true, maxlength: 2000 },
    images: {
      type: [reviewImageSchema],
      default: [],
      validate: {
        validator(images) {
          return images.length <= 5;
        },
        message: 'A review can have at most 5 images',
      },
    },
    status: {
      type: String,
      enum: ['PUBLISHED', 'HIDDEN', 'REMOVED'],
      default: 'PUBLISHED',
      index: true,
    },
    isVerifiedPurchase: { type: Boolean, default: true },
    sellerReply: {
      text: { type: String, trim: true, maxlength: 1000 },
      repliedAt: Date,
    },
    editedAt: Date,
    removedAt: Date,
    removedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    moderation: {
      reason: String,
      moderatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      moderatedAt: Date,
      history: [
        {
          action: String,
          reason: String,
          actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          at: { type: Date, default: Date.now },
        },
      ],
    },
  },
  { timestamps: true },
);

productReviewSchema.index({ orderId: 1, productId: 1, buyerId: 1 }, { unique: true });
productReviewSchema.index({ productId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('ProductReview', productReviewSchema);
