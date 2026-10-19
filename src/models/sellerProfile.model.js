const mongoose = require('mongoose');

const sellerProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    shopName: { type: String, required: true, trim: true, minlength: 3, maxlength: 100 },
    shopSlug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    description: { type: String, trim: true, maxlength: 2000 },
    avatar: { type: String, trim: true },
    coverImage: { type: String, trim: true },
    contactPhone: { type: String, trim: true },
    verificationStatus: {
      type: String,
      enum: ['NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED'],
      default: 'NOT_SUBMITTED',
      index: true,
    },
    status: { type: String, enum: ['ACTIVE', 'SUSPENDED'], default: 'ACTIVE', index: true },
    totalSales: { type: Number, default: 0, min: 0 },
    ratingAverage: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model('SellerProfile', sellerProfileSchema);
