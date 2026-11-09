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
      enum: ['NOT_SUBMITTED', 'DRAFT', 'PENDING', 'VERIFIED', 'REJECTED'],
      default: 'PENDING',
      index: true,
    },
    verificationMethod: { type: String, default: 'MANUAL_REVIEW', trim: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    legalName: { type: String, trim: true, maxlength: 100 },
    phone: { type: String, trim: true, maxlength: 20 },
    contactAddress: { type: String, trim: true, maxlength: 300 },
    bankSnapshot: { bankName: String, bankBin: String, accountNumber: String, accountName: String },
    bankFingerprint: String,
    consentAt: Date,
    contentVersion: { type: Number, default: 0 },
    history: [
      {
        _id: false,
        action: String,
        actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        note: { type: String, maxlength: 1000 },
        at: { type: Date, default: Date.now },
      },
    ],
    providerReference: { type: String, trim: true },
    submittedAt: { type: Date, default: Date.now },
    reviewedAt: Date,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectionReason: { type: String, trim: true },
  },
  { timestamps: true },
);

sellerVerificationSchema.index(
  { ownerId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      ownerId: { $type: 'objectId' },
      verificationStatus: { $in: ['DRAFT', 'PENDING'] },
    },
    name: 'one_open_manual_verification',
  },
);
module.exports = mongoose.model('SellerVerification', sellerVerificationSchema);
