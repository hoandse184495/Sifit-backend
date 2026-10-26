const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    label: { type: String, required: true, trim: true, maxlength: 100 },
    recipientName: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, required: true, trim: true },
    addressLine: { type: String, required: true, trim: true, maxlength: 255 },
    ward: { type: String, required: true, trim: true },
    province: { type: String, required: true, trim: true },
    postalCode: { type: String, trim: true },
    addressType: {
      type: String,
      enum: ['SHIPPING', 'PICKUP', 'BOTH'],
      default: 'BOTH',
      index: true,
    },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

addressSchema.index({ userId: 1, addressType: 1, isDefault: 1 });

module.exports = mongoose.model('Address', addressSchema);
