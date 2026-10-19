const commissionStatus = require('../constants/commissionStatus');
const Commission = require('../models/commission.model');

const createPendingForOrders = async (orders, session) => {
  const created = [];

  for (const order of orders) {
    try {
      const records = await Commission.create(
        [
          {
            orderId: order._id,
            sellerId: order.sellerId,
            subtotal: order.subtotal,
            commissionRateBasisPoints: order.commissionRateBasisPoints,
            commissionAmount: order.commissionAmount,
            sellerProceeds: order.sellerProceeds,
            status: commissionStatus.PENDING,
          },
        ],
        { session },
      );
      created.push(records[0]);
    } catch (error) {
      if (error.code !== 11000) {
        throw error;
      }
    }
  }

  return created;
};

const reverseForOrders = async (orderIds, session) =>
  Commission.updateMany(
    { orderId: { $in: orderIds }, status: { $ne: commissionStatus.REVERSED } },
    { status: commissionStatus.REVERSED, reversedAt: new Date() },
    { session },
  );

const listCommissions = async ({ page = 1, limit = 20, status }) => {
  const query = {};
  if (status) query.status = status;

  const [items, total] = await Promise.all([
    Commission.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Commission.countDocuments(query),
  ]);

  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

module.exports = {
  createPendingForOrders,
  listCommissions,
  reverseForOrders,
};
