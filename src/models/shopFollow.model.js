const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  {
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SellerProfile',
      required: true,
      immutable: true,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },
    following: { type: Boolean, default: true },
    notifyNewProducts: { type: Boolean, default: true },
    followedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
schema.index({ buyerId: 1, shopId: 1 }, { unique: true });
schema.index({ buyerId: 1, following: 1, followedAt: -1 });
schema.index({ sellerId: 1, following: 1, notifyNewProducts: 1, followedAt: 1 });
module.exports = mongoose.model('ShopFollow', schema);
