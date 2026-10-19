const mongoose = require('mongoose');

const wishlistItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const wishlistSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    items: { type: [wishlistItemSchema], default: [] },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Wishlist', wishlistSchema);
