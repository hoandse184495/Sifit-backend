const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  recoveryId: { type: mongoose.Schema.Types.ObjectId, ref: 'SellerRecovery', required: true, index: true },
  reference: { type: String, required: true, unique: true },
  amount: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  receivedAt: { type: Date, required: true },
  note: { type: String, required: true, maxlength: 1000 },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sha256: { type: String, required: true },
  mime: { type: String, required: true },
  proof: { type: Buffer, required: true, select: false },
}, { timestamps: true });
module.exports = mongoose.model('RecoveryReceipt', schema);
