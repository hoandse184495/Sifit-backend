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
        'DEADLINE_REMINDER',
        'SELLER_RECOVERY',
        'PRODUCT_SUBMITTED',
        'PRODUCT_APPROVED',
        'FOLLOWED_SHOP_NEW_PRODUCT',
        'PRODUCT_REJECTED',
        'PRODUCT_HIDDEN',
        'PRODUCT_REPORT_RESOLVED',
        'REPORTING_POLICY',
        'ORDER_CREATED',
        'OFFER_UPDATED',
        'ORDER_ACCEPTED',
        'ORDER_COMPLETED',
        'PAYMENT_CONFIRMED',
        'PAYMENT_REVIEW_UPDATED',
        'SELLER_VERIFICATION_UPDATED',
        'ORDER_CANCELLED',
        'SHIPMENT_CREATED',
        'SHIPMENT_PICKED_UP',
        'SHIPMENT_DELIVERED',
        'DELIVERY_CONFIRMED',
        'DISPUTE_OPENED',
        'DISPUTE_RESOLVED',
        'DISPUTE_UPDATED',
        'NEW_PRODUCT_REVIEW',
        'NEW_SELLER_RATING',
        'NEW_MESSAGE',
        'PAYOUT_ELIGIBLE',
        'PAYOUT_COMPLETED',
        'REFUND_UPDATED',
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
        'OFFER',
        'PAYMENT',
        'SHIPMENT',
        'DISPUTE',
        'REVIEW',
        'CONVERSATION',
        'PAYOUT',
        'REFUND',
        'VERIFICATION',
      ],
      required: true,
    },
    resourceId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'SellerProfile' },
    sourceApprovedAt: Date,
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
