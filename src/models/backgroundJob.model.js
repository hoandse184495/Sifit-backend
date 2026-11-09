const mongoose = require('mongoose');

// One durable lease per job, shared by all API processes using this database.
const schema = new mongoose.Schema(
  {
    _id: { type: String },
    owner: String,
    lockedUntil: Date,
    nextRunAt: Date,
    lastStartedAt: Date,
    lastFinishedAt: Date,
    lastSucceededAt: Date,
    lastError: String,
    runCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },
    lastResult: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true },
);

module.exports = mongoose.model('BackgroundJob', schema);
