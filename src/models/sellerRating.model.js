const mongoose = require('mongoose');

const sellerRatingSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      unique: true,
      index: true,
    },
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
    communicationRating: { type: Number, min: 1, max: 5, validate: Number.isInteger },
    shippingRating: { type: Number, min: 1, max: 5, validate: Number.isInteger },
    descriptionAccuracyRating: { type: Number, min: 1, max: 5, validate: Number.isInteger },
    comment: { type: String, trim: true, maxlength: 2000 },
    status: {
      type: String,
      enum: ['PUBLISHED', 'HIDDEN', 'REMOVED'],
      default: 'PUBLISHED',
      index: true,
    },
    isVerifiedPurchase: { type: Boolean, default: true },
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

sellerRatingSchema.index({ sellerId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('SellerRating', sellerRatingSchema);
