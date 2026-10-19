const mongoose = require('mongoose');

const userBlockSchema = new mongoose.Schema(
  {
    blockerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    blockedId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    active: { type: Boolean, default: true, index: true },
    blockedAt: { type: Date, default: Date.now },
    unblockedAt: Date,
  },
  { timestamps: true },
);

userBlockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });

module.exports = mongoose.model('UserBlock', userBlockSchema);
