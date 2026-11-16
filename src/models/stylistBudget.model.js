const mongoose = require('mongoose');
module.exports = mongoose.model('StylistBudget', new mongoose.Schema({
  _id: String,
  used: { type: Number, default: 0 },
}));
