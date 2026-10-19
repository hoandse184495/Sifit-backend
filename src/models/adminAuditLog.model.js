const mongoose = require('mongoose');

const adminAuditLogSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    action: { type: String, required: true, trim: true, index: true },
    resourceType: { type: String, required: true, trim: true, index: true },
    resourceId: { type: mongoose.Schema.Types.ObjectId, index: true },
    reason: { type: String, trim: true, maxlength: 1000 },
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed,
    ipAddress: { type: String, trim: true },
    userAgent: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

adminAuditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AdminAuditLog', adminAuditLogSchema);
