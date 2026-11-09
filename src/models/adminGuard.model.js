const mongoose = require('mongoose');
// One shared document serializes changes to the active administrator set.
const schema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    revision: { type: Number, default: 0 },
  },
  { timestamps: true },
);
module.exports = mongoose.model('AdminGuard', schema);
