const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  {
    provider: { type: String, required: true },
    reference: { type: String, required: true, maxlength: 150 },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', index: true },
    checkoutGroupId: { type: mongoose.Schema.Types.ObjectId, ref: 'CheckoutGroup', index: true },
    providerPaymentId: { type: String, required: true },
    merchantReference: { type: String, required: true },
    amount: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    currency: { type: String, enum: ['VND'], required: true },
    occurredAt: { type: Date, required: true },
    status: { type: String, enum: ['MATCHED', 'UNMATCHED'], required: true },
    source: { type: String, enum: ['WEBHOOK', 'RECONCILIATION'], required: true },
  },
  { timestamps: true },
);
schema.index({ provider: 1, reference: 1 }, { unique: true });
schema.index({ createdAt: -1 });
module.exports = mongoose.model('PaymentTransaction', schema);
