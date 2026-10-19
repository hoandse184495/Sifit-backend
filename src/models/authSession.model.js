const mongoose = require('mongoose');

const authSessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    familyId: {
      type: String,
      required: true,
      index: true,
    },
    tokenIdHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    previousTokenIdHash: {
      type: String,
    },
    replacedByTokenIdHash: {
      type: String,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
    revokedAt: {
      type: Date,
    },
    revokedReason: {
      type: String,
      trim: true,
    },
    userAgent: {
      type: String,
      trim: true,
    },
    ipAddress: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('AuthSession', authSessionSchema);
