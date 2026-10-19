const mongoose = require('mongoose');
const commissionStatus = require('../constants/commissionStatus');

const commissionSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      unique: true,
      index: true,
    },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    subtotal: { type: Number, required: true, min: 0, validate: Number.isInteger },
    commissionRateBasisPoints: { type: Number, required: true, min: 0, validate: Number.isInteger },
    commissionAmount: { type: Number, required: true, min: 0, validate: Number.isInteger },
    sellerProceeds: { type: Number, required: true, min: 0, validate: Number.isInteger },
    status: {
      type: String,
      enum: Object.values(commissionStatus),
      default: commissionStatus.PENDING,
      index: true,
    },
    recognizedAt: Date,
    reversedAt: Date,
  },
  { timestamps: true },
);

module.exports = mongoose.model('Commission', commissionSchema);
