const mongoose = require('mongoose');

const sellerVerificationSchema = new mongoose.Schema(
  {
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SellerProfile',
      required: true,
      index: true,
    },
    verificationStatus: {
      type: String,
      enum: ['NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED'],
      default: 'PENDING',
      index: true,
    },
    verificationMethod: { type: String, default: 'SIMULATED_REVIEW', trim: true },
    providerReference: { type: String, trim: true },
    submittedAt: { type: Date, default: Date.now },
    reviewedAt: Date,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectionReason: { type: String, trim: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model('SellerVerification', sellerVerificationSchema);
