const mongoose = require('mongoose');

const paymentWebhookEventSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true, trim: true, index: true },
    eventId: { type: String, required: true, trim: true },
    eventType: { type: String, required: true, trim: true },
    providerPaymentId: { type: String, trim: true, index: true },
    merchantReference: { type: String, trim: true, index: true },
    status: {
      type: String,
      enum: ['RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED'],
      default: 'RECEIVED',
    },
    receivedAt: { type: Date, default: Date.now },
    processedAt: Date,
    payloadHash: { type: String, required: true },
    errorMessage: { type: String, trim: true },
  },
  { timestamps: true },
);

paymentWebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

module.exports = mongoose.model('PaymentWebhookEvent', paymentWebhookEventSchema);
