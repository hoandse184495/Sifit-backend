const Order = require('../models/order.model');
const Commission = require('../models/commission.model');
const User = require('../models/user.model');
const auditService = require('./adminAudit.service');

const csvEscape = (value) => {
  if (value === undefined || value === null) return '';
  const stringValue = String(value);
  const safeValue = /^[=+\-@]/.test(stringValue) ? `'${stringValue}` : stringValue;
  return `"${safeValue.replace(/"/g, '""')}"`;
};

const toCsv = (headers, rows) =>
  [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ].join('\n');

const dateQuery = ({ startDate, endDate }) => {
  if (!startDate && !endDate) return {};
  const createdAt = {};
  if (startDate) createdAt.$gte = startDate;
  if (endDate) createdAt.$lte = endDate;
  return { createdAt };
};

const exportOrders = async (admin, filters, req) => {
  const orders = await Order.find(dateQuery(filters)).sort({ createdAt: -1 }).limit(filters.limit);
  await auditService.record({
    admin,
    action: 'EXPORT_ORDERS',
    resourceType: 'REPORT',
    reason: 'CSV export',
    req,
  });
  return toCsv(
    [
      'id',
      'buyerId',
      'sellerId',
      'subtotal',
      'commissionAmount',
      'sellerProceeds',
      'paymentStatus',
      'orderStatus',
      'createdAt',
    ],
    orders.map((order) => ({
      id: order.id,
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      subtotal: order.subtotal,
      commissionAmount: order.commissionAmount,
      sellerProceeds: order.sellerProceeds,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      createdAt: order.createdAt.toISOString(),
    })),
  );
};

const exportCommissions = async (admin, filters, req) => {
  const commissions = await Commission.find(dateQuery(filters))
    .sort({ createdAt: -1 })
    .limit(filters.limit);
  await auditService.record({
    admin,
    action: 'EXPORT_COMMISSIONS',
    resourceType: 'REPORT',
    reason: 'CSV export',
    req,
  });
  return toCsv(
    [
      'id',
      'orderId',
      'sellerId',
      'subtotal',
      'commissionAmount',
      'sellerProceeds',
      'status',
      'createdAt',
    ],
    commissions.map((commission) => ({
      id: commission.id,
      orderId: commission.orderId,
      sellerId: commission.sellerId,
      subtotal: commission.subtotal,
      commissionAmount: commission.commissionAmount,
      sellerProceeds: commission.sellerProceeds,
      status: commission.status,
      createdAt: commission.createdAt.toISOString(),
    })),
  );
};

const exportUsers = async (admin, filters, req) => {
  const users = await User.find(dateQuery(filters)).sort({ createdAt: -1 }).limit(filters.limit);
  await auditService.record({
    admin,
    action: 'EXPORT_USERS',
    resourceType: 'REPORT',
    reason: 'CSV export',
    req,
  });
  return toCsv(
    ['id', 'fullName', 'email', 'role', 'status', 'createdAt'],
    users.map((user) => ({
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
    })),
  );
};

module.exports = { exportCommissions, exportOrders, exportUsers };
