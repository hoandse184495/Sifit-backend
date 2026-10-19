const mongoose = require('mongoose');

const notificationPreferenceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    inAppEnabled: { type: Boolean, default: true },
    messageNotifications: { type: Boolean, default: true },
    orderNotifications: { type: Boolean, default: true },
    productNotifications: { type: Boolean, default: true },
    shippingNotifications: { type: Boolean, default: true },
    reviewNotifications: { type: Boolean, default: true },
    payoutNotifications: { type: Boolean, default: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model('NotificationPreference', notificationPreferenceSchema);
