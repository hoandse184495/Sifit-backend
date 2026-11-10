const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  purpose: { type: String, enum: ['reset', 'verify'], required: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  version: { type: Number, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  consumedAt: Date,
}, { timestamps: true });
module.exports = mongoose.model('EmailAction', schema);
