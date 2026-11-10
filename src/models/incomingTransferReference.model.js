const mongoose = require('mongoose');
module.exports = mongoose.model('IncomingTransferReference', new mongoose.Schema({
  _id: String,
  sourceType: { type: String, enum: ['PAYOS', 'RECOVERY'], required: true },
  sourceId: { type: String, required: true },
  amount: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
}, { timestamps: true }));
