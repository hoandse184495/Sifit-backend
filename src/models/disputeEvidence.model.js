const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  {
    disputeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dispute',
      required: true,
      index: true,
    },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    authorRole: { type: String, required: true, enum: ['BUYER', 'SELLER', 'ADMIN'] },
    caption: { type: String, required: true, maxlength: 500 },
    category: {
      type: String,
      enum: ['GENERAL', 'RETURN_SHIPPING', 'RETURN_RECEIPT'],
      default: 'GENERAL',
    },
    data: { type: Buffer, required: true, select: false },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    sha256: { type: String, required: true },
  },
  { timestamps: true },
);
schema.index({ disputeId: 1, authorId: 1, sha256: 1 }, { unique: true });
module.exports = mongoose.model('DisputeEvidence', schema);
