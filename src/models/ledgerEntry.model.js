const mongoose = require('mongoose');

const ledgerLineSchema = new mongoose.Schema(
  {
    account: { type: String, required: true, trim: true },
    debit: { type: Number, required: true, min: 0, default: 0, validate: Number.isInteger },
    credit: { type: Number, required: true, min: 0, default: 0, validate: Number.isInteger },
    currency: { type: String, enum: ['VND'], default: 'VND' },
    partyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false },
);

const ledgerEntrySchema = new mongoose.Schema(
  {
    sourceType: { type: String, required: true, trim: true },
    sourceId: { type: String, required: true, trim: true },
    sourceEventKey: { type: String, required: true, unique: true, index: true },
    description: { type: String, trim: true },
    lines: {
      type: [ledgerLineSchema],
      required: true,
      validate: {
        validator(lines) {
          const debit = lines.reduce((sum, line) => sum + line.debit, 0);
          const credit = lines.reduce((sum, line) => sum + line.credit, 0);
          return lines.length >= 2 && debit === credit;
        },
        message: 'Ledger entry must balance',
      },
    },
    postedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

module.exports = mongoose.model('LedgerEntry', ledgerEntrySchema);
