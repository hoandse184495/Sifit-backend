const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  {
    verificationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SellerVerification',
      required: true,
      index: true,
    },
    kind: { type: String, enum: ['OWNER_IDENTITY', 'BANK_OWNERSHIP'], required: true },
    data: { type: Buffer, required: true, select: false },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    sha256: { type: String, required: true },
  },
  { timestamps: true },
);
schema.index({ verificationId: 1, kind: 1 }, { unique: true });
module.exports = mongoose.model('SellerVerificationDocument', schema);
