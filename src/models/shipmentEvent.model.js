const mongoose = require('mongoose');

const shipmentEventSchema = new mongoose.Schema(
  {
    shipmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shipment',
      required: true,
      index: true,
    },
    provider: { type: String, required: true, trim: true },
    providerEventId: { type: String, required: true, trim: true },
    eventType: { type: String, required: true, trim: true },
    status: { type: String, required: true, trim: true },
    occurredAt: { type: Date, required: true },
    receivedAt: { type: Date, default: Date.now },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

shipmentEventSchema.index({ provider: 1, providerEventId: 1 }, { unique: true });

module.exports = mongoose.model('ShipmentEvent', shipmentEventSchema);
