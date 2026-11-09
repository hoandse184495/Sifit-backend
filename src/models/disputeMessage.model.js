const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  {
    disputeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dispute',
      required: true,
      index: true,
    },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    authorRole: { type: String, required: true, enum: ['BUYER', 'SELLER', 'ADMIN'] },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    idempotencyKey: { type: String, required: true },
  },
  { timestamps: true },
);
schema.index({ disputeId: 1, authorId: 1, idempotencyKey: 1 }, { unique: true });
module.exports = mongoose.model('DisputeMessage', schema);
