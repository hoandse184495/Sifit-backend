const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    bankName: { type: String, required: true, trim: true, maxlength: 100 },
    bankBin: { type: String, required: true, match: /^\d{6}$/ },
    accountNumber: { type: String, required: true, trim: true, match: /^[A-Za-z0-9]{4,30}$/ },
    accountName: { type: String, required: true, trim: true, minlength: 3, maxlength: 100 },
  },
  { timestamps: true },
);
module.exports = mongoose.model('SellerBankAccount', schema);
