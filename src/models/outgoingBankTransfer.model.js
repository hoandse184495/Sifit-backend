const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true },
    resourceType: { type: String, enum: ['REFUND', 'PAYOUT'], required: true },
    resourceId: { type: mongoose.Schema.Types.ObjectId, required: true },
    amount: { type: Number, required: true, min: 1, validate: Number.isInteger },
  },
  { timestamps: true },
);
module.exports = mongoose.model('OutgoingBankTransfer', schema);
