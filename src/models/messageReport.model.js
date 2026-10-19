const mongoose = require('mongoose');

const messageReportSchema = new mongoose.Schema(
  {
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
      required: true,
      index: true,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    reportedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    status: {
      type: String,
      enum: ['OPEN', 'RESOLVED'],
      default: 'OPEN',
      index: true,
    },
    resolutionNote: { type: String, trim: true, maxlength: 1000 },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    resolvedAt: Date,
  },
  { timestamps: true },
);

messageReportSchema.index(
  { messageId: 1, reporterId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'OPEN' } },
);

module.exports = mongoose.model('MessageReport', messageReportSchema);
