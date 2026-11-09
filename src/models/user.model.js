const mongoose = require('mongoose');
const roles = require('../constants/roles');

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true,
    },
    passwordHash: {
      type: String,
      required() { return this.authProvider !== 'google'; },
      select: false,
    },
    googleId: { type: String, select: false, unique: true, sparse: true },
    authProvider: { type: String, enum: ['local', 'google', 'both'], default: 'local' },
    role: {
      type: String,
      enum: Object.values(roles),
      default: roles.BUYER,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'SUSPENDED'],
      default: 'ACTIVE',
    },
    avatar: {
      type: String,
      trim: true,
    },
    avatarPublicId: { type: String, select: false },
    productReportVersion: { type: Number, default: 0, select: false },
    reportingBlockedUntil: { type: Date, select: false },
    reportingWarning: { type: String, maxlength: 1000, select: false },
    phone: {
      type: String,
      trim: true,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    lastLoginAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        delete ret.passwordHash;
        delete ret.googleId;
        delete ret.avatarPublicId;
        delete ret.productReportVersion;
        delete ret.reportingBlockedUntil;
        delete ret.reportingWarning;
        delete ret.__v;
        return ret;
      },
    },
  },
);

module.exports = mongoose.model('User', userSchema);
