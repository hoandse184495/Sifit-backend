const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  requestId: { type: String, required: true },
  active: { type: Boolean, default: true },
  status: { type: String, default: 'queued' },
  engine: String,
  products: [mongoose.Schema.Types.Mixed],
  cost: Number,
  providerCost: Number,
  estimatedSeconds: Number,
  completedAt: Date,
  step: { type: Number, default: 0 },
  predictionId: String,
  phase: { type: String, default: 'queued' },
  error: String,
  counterIds: [String],
  refunded: { type: Boolean, default: false },
  photo: { type: Buffer, select: false },
  output: { type: Buffer, select: false },
  seed: Number,
  consentAt: Date,
  expiresAt: { type: Date, default: () => new Date(Date.now() + 7 * 86400000), expires: 0 },
}, { timestamps: true });
schema.index({ userId: 1, requestId: 1 }, { unique: true });
schema.index({ userId: 1, active: 1 }, { unique: true, partialFilterExpression: { active: true } });
module.exports = mongoose.model('StylistJob', schema);
