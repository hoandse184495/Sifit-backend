const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    type: {
      type: String,
      enum: [
        'PRODUCT_SUBMITTED',
        'PRODUCT_APPROVED',
        'PRODUCT_REJECTED',
        'ORDER_CREATED',
        'PAYMENT_CONFIRMED',
        'ORDER_CANCELLED',
        'SHIPMENT_CREATED',
        'SHIPMENT_PICKED_UP',
        'SHIPMENT_DELIVERED',
        'DELIVERY_CONFIRMED',
        'DISPUTE_OPENED',
        'DISPUTE_RESOLVED',
        'NEW_PRODUCT_REVIEW',
        'NEW_SELLER_RATING',
        'NEW_MESSAGE',
        'PAYOUT_ELIGIBLE',
        'PAYOUT_COMPLETED',
      ],
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    body: { type: String, required: true, trim: true, maxlength: 500 },
    resourceType: {
      type: String,
      enum: [
        'PRODUCT',
        'ORDER',
        'PAYMENT',
        'SHIPMENT',
        'DISPUTE',
        'REVIEW',
        'CONVERSATION',
        'PAYOUT',
      ],
      required: true,
    },
    resourceId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    isRead: { type: Boolean, default: false, index: true },
    readAt: Date,
    eventKey: { type: String, required: true, trim: true },
    deletedAt: Date,
  },
  { timestamps: true },
);

notificationSchema.index({ recipientId: 1, eventKey: 1 }, { unique: true });
notificationSchema.index({ recipientId: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
