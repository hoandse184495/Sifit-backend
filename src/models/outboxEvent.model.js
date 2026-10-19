const mongoose = require('mongoose');

const outboxEventSchema = new mongoose.Schema(
  {
    eventKey: { type: String, required: true, unique: true, trim: true },
    type: { type: String, required: true, trim: true, index: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'PROCESSED', 'FAILED'],
      default: 'PENDING',
      index: true,
    },
    attempts: { type: Number, default: 0, min: 0 },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    lockedAt: Date,
    processedAt: Date,
    lastError: String,
  },
  { timestamps: true },
);

outboxEventSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });

module.exports = mongoose.model('OutboxEvent', outboxEventSchema);
