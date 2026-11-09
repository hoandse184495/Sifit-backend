const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  nonceHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
});

module.exports = mongoose.model('GoogleLoginChallenge', schema);
