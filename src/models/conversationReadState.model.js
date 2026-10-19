const mongoose = require('mongoose');

const conversationReadStateSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    lastReadMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
    },
    lastReadAt: Date,
  },
  { timestamps: true },
);

conversationReadStateSchema.index({ conversationId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('ConversationReadState', conversationReadStateSchema);
