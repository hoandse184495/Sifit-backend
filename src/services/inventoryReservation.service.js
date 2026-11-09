const Product = require('../models/product.model');
const Order = require('../models/order.model');
const ApiError = require('../utils/ApiError');
const conflictingProducts = async (groupId, ids, session) => {
  const otherOrders = await Order.find({
    checkoutGroupId: { $ne: groupId },
    'items.productId': { $in: ids },
    orderStatus: { $nin: ['CANCELLED', 'REFUNDED'] },
  })
    .select('items.productId')
    .session(session);
  return new Set(otherOrders.flatMap((order) => order.items.map((item) => String(item.productId))));
};
const release = async (groupId, ids, session) => {
  const conflicts = await conflictingProducts(groupId, ids, session);
  const safeIds = ids.filter((id) => !conflicts.has(String(id)));
  return Product.updateMany(
    {
      _id: { $in: safeIds },
      status: 'RESERVED',
      $or: [{ reservationGroupId: groupId }, { reservationGroupId: null }],
    },
    { $set: { status: 'ACTIVE' }, $unset: { reservationGroupId: 1 } },
    { session },
  );
};
const assertAvailable = async (groupId, orders, session, allowReleased = false) => {
  const items = orders.flatMap((order) =>
    order.items.map((item) => ({
      ...(item.toObject ? item.toObject() : item),
      sellerId: order.sellerId,
    })),
  );
  const ids = items.map((item) => item.productId);
  if (!ids.length || new Set(ids.map(String)).size !== ids.length)
    throw new ApiError(409, 'Danh sách sản phẩm của đơn chưa hợp lệ.');
  const conflicts = await conflictingProducts(groupId, ids, session);
  const { visibleSellerIds } = require('./publicSeller.service');
  const sellers = await visibleSellerIds(
    orders.map((order) => order.sellerId),
    session,
  );
  for (const item of items) {
    const product = await Product.findById(item.productId).session(session);
    const owned =
      product?.status === 'RESERVED' &&
      (!product.reservationGroupId || String(product.reservationGroupId) === String(groupId));
    const released = allowReleased && product?.status === 'ACTIVE' && !product.reservationGroupId;
    if (
      conflicts.has(String(item.productId)) ||
      !sellers.has(String(item.sellerId)) ||
      !product ||
      product.deletedAt ||
      String(product.sellerId) !== String(item.sellerId) ||
      (!owned && !released)
    )
      throw new ApiError(409, 'Sản phẩm đã thuộc đơn khác hoặc không còn sẵn để tiếp tục đơn.');
  }
  return items;
};
const acquireForPayment = async (groupId, orders, session, allowReleased = false) => {
  const items = await assertAvailable(groupId, orders, session, allowReleased);
  for (const item of items.sort((a, b) => String(a.productId).localeCompare(String(b.productId)))) {
    const product = await Product.findOneAndUpdate(
      {
        _id: item.productId,
        sellerId: item.sellerId,
        deletedAt: null,
        $or: [
          { status: 'RESERVED', reservationGroupId: groupId },
          { status: 'RESERVED', reservationGroupId: null },
          ...(allowReleased ? [{ status: 'ACTIVE', reservationGroupId: null }] : []),
        ],
      },
      { $set: { status: 'SOLD' }, $unset: { reservationGroupId: 1 } },
      { new: true, session },
    );
    if (!product) throw new ApiError(409, 'Sản phẩm không còn sẵn để tiếp tục đơn.');
  }
};
module.exports = { release, acquireForPayment, assertAvailable };
