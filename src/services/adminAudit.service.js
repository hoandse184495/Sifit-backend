const AdminAuditLog = require('../models/adminAuditLog.model');

const sensitiveKeys = [
  'password',
  'passwordHash',
  'token',
  'secret',
  'jwt',
  'apiKey',
  'bank',
  'kyc',
];

const maskSensitive = (value) => {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(maskSensitive);

  return Object.entries(value).reduce((result, [key, entry]) => {
    if (sensitiveKeys.some((sensitive) => key.toLowerCase().includes(sensitive))) {
      result[key] = '[REDACTED]';
      return result;
    }
    result[key] = maskSensitive(entry);
    return result;
  }, {});
};

const record = ({ admin, action, resourceType, resourceId, reason, before, after, req }) =>
  AdminAuditLog.create({
    adminId: admin._id,
    action,
    resourceType,
    resourceId,
    reason,
    before: maskSensitive(before),
    after: maskSensitive(after),
    ipAddress: req?.ip,
    userAgent: req?.get?.('user-agent'),
  });

const list = async ({
  page = 1,
  limit = 20,
  action,
  resourceType,
  adminId,
  startDate,
  endDate,
}) => {
  const query = {};
  if (action) query.action = action;
  if (resourceType) query.resourceType = resourceType;
  if (adminId) query.adminId = adminId;
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = startDate;
    if (endDate) query.createdAt.$lte = endDate;
  }

  const [items, total] = await Promise.all([
    AdminAuditLog.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({ path: 'adminId', select: 'fullName avatar role status' }),
    AdminAuditLog.countDocuments(query),
  ]);

  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

module.exports = { list, record };
