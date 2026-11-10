const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
  disputeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dispute', required: true, unique: true },
  payoutId: { type: mongoose.Schema.Types.ObjectId, ref: 'SellerPayout', required: true },
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  buyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  requiredAmount: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  refundAmount: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  receivedAmount: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['OPEN', 'FUNDED', 'REFUNDED'], default: 'OPEN', index: true },
  reason: { type: String, required: true, maxlength: 1000 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  refundId: { type: mongoose.Schema.Types.ObjectId, ref: 'Refund' },
}, { timestamps: true });
module.exports = mongoose.model('SellerRecovery', schema);
