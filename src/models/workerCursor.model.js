const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    afterId: { type: mongoose.Schema.Types.ObjectId, default: null },
    untilId: { type: mongoose.Schema.Types.ObjectId, default: null },
    revision: { type: Number, default: 0 },
  },
  { timestamps: true },
);
module.exports = mongoose.model('WorkerCursor', schema);
