const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  actionId: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailAction', required: true, unique: true },
  encrypted: { type: String, required: true, select: false },
  status: { type: String, enum: ['PENDING', 'PROCESSING', 'SENT', 'FAILED', 'EXPIRED'], default: 'PENDING', index: true },
  attempts: { type: Number, default: 0 },
  lockedAt: Date,
  nextAttemptAt: { type: Date, default: Date.now },
  lastError: String,
  sentAt: Date,
  expiresAt: { type: Date, required: true },
  purgeAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });
schema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
module.exports = mongoose.model('MailDelivery', schema);
