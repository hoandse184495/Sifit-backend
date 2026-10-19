const mongoose = require('mongoose');

const addressSnapshotSchema = new mongoose.Schema(
  {
    recipientName: String,
    phone: String,
    addressLine: String,
    ward: String,
    district: String,
    province: String,
    city: String,
    postalCode: String,
  },
  { _id: false },
);

const shipmentSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    provider: { type: String, required: true, trim: true },
    trackingNumber: { type: String, required: true, trim: true, index: true },
    providerShipmentId: { type: String, required: true, trim: true, unique: true, index: true },
    idempotencyKey: { type: String, trim: true },
    pickupAddressSnapshot: { type: addressSnapshotSchema, required: true },
    deliveryAddressSnapshot: { type: addressSnapshotSchema, required: true },
    shippingFee: { type: Number, required: true, min: 0, validate: Number.isInteger },
    codAmount: { type: Number, default: 0, min: 0, validate: Number.isInteger },
    weightGrams: { type: Number, required: true, min: 1 },
    packageLengthCm: { type: Number, required: true, min: 1 },
    packageWidthCm: { type: Number, required: true, min: 1 },
    packageHeightCm: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: [
        'PENDING',
        'READY_FOR_PICKUP',
        'PICKED_UP',
        'IN_TRANSIT',
        'OUT_FOR_DELIVERY',
        'DELIVERED',
        'DELIVERY_FAILED',
        'RETURNING',
        'RETURNED',
        'CANCELLED',
      ],
      default: 'PENDING',
      index: true,
    },
    estimatedDeliveryAt: Date,
    pickedUpAt: Date,
    deliveredAt: Date,
    failedAt: Date,
    cancelledAt: Date,
    deliveryReviews: [{
      status: { type: String, enum: ['DELIVERED', 'DELIVERY_FAILED'] },
      reason: String,
      adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      reviewedAt: { type: Date, default: Date.now },
    }],
  },
  { timestamps: true },
);

shipmentSchema.index({ sellerId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Shipment', shipmentSchema);
