const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  {
    refundId: { type: mongoose.Schema.Types.ObjectId, ref: 'Refund', required: true, unique: true },
    data: { type: Buffer, required: true, select: false },
    mimeType: { type: String, required: true },
    sha256: { type: String, required: true },
  },
  { timestamps: true },
);
module.exports = mongoose.model('RefundProof', schema);
