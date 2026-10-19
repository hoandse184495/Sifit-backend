const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    publicId: { type: String, trim: true },
    mimeType: { type: String, trim: true },
    size: { type: Number, min: 0 },
  },
  { _id: false },
);

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      immutable: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['TEXT', 'IMAGE', 'SYSTEM'],
      default: 'TEXT',
      required: true,
    },
    content: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    attachments: {
      type: [attachmentSchema],
      default: [],
    },
    clientMessageId: {
      type: String,
      trim: true,
      maxlength: 80,
    },
    editedAt: Date,
    deletedAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

messageSchema.index(
  { conversationId: 1, senderId: 1, clientMessageId: 1 },
  { unique: true, partialFilterExpression: { clientMessageId: { $type: 'string' } } },
);
messageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model('Message', messageSchema);
