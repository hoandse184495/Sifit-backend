const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    participants: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
      required: true,
      validate: {
        validator(value) {
          return value.length === 2 && new Set(value.map(String)).size === 2;
        },
        message: 'Conversation must have two distinct participants',
      },
    },
    buyerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    lastMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
    },
    lastMessageAt: {
      type: Date,
      index: true,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'BLOCKED', 'CLOSED'],
      default: 'ACTIVE',
      index: true,
    },
  },
  { timestamps: true },
);

conversationSchema.index({ buyerId: 1, sellerId: 1, productId: 1 }, { unique: true });
conversationSchema.index({ participants: 1, lastMessageAt: -1, updatedAt: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);
