const env = require('../config/env');
const Order = require('../models/order.model');
const Dispute = require('../models/dispute.model');
const User = require('../models/user.model');
const Payment = require('../models/payment.model');
const transaction = require('../utils/withTransaction');
const events = require('./notificationEvent.service');
const awaiting = { paymentStatus: 'PAID', orderStatus: { $in: ['PAID', 'PROCESSING'] } };
const notify = async (recipients, type, id, stage, text, session) => {
  for (const recipientId of recipients) await events.enqueueNotificationEvent({
    eventKey: `deadline:${type}:${id}:${stage}:${recipientId}`, type: 'NOTIFICATION_CREATE',
    payload: { recipientId, type: 'DEADLINE_REMINDER', title: 'Hạn xử lý đơn hàng / khiếu nại', body: text,
      resourceType: type, resourceId: id, eventKey: `deadline:${type}:${id}:${stage}` },
  }, { session });
};
const run = async ({ now = new Date(), limit = 20 } = {}) => {
  let reminded = 0; let escalated = 0;
  const admins = (await User.find({ role: 'ADMIN', status: 'ACTIVE' }).select('_id')).map(u => u._id);
  // Bootstrap deadlines separately so already-reminded records cannot starve later batches.
  const legacyOrders = await Order.find({ ...awaiting, sellerShipBy: null }).sort({ _id: 1 }).limit(limit);
  for (const order of legacyOrders) {
    const payment = await Payment.findOne({ checkoutGroupId: order.checkoutGroupId, paidAt: { $ne: null } }).sort({ paidAt: 1 });
    const start = payment?.paidAt || order.createdAt;
    await Order.updateOne({ _id: order._id, ...awaiting, sellerShipBy: null }, { $set: { sellerShipBy: new Date(start.getTime() + env.SELLER_SHIP_DAYS * 86400000) } });
  }
  const orders = await Order.find({ ...awaiting, sellerShipBy: { $lte: new Date(now.getTime() + env.SHIP_REMINDER_HOURS * 3600000) },
    $or: [{ fulfillmentReminderAt: null }, { fulfillmentOverdueAt: null, sellerShipBy: { $lte: now } }] }).sort({ sellerShipBy: 1, _id: 1 }).limit(limit);
  for (const candidate of orders) await transaction(async session => {
    const order = await Order.findOneAndUpdate({ _id: candidate._id, ...awaiting }, { $inc: { settlementVersion: 1 } }, { new: true, session });
    if (!order) return;
    if (!order.fulfillmentReminderAt) {
      order.fulfillmentReminderAt = now;
      await notify([order.sellerId], 'ORDER', order._id, 'ship-reminder', `Vui lòng bàn giao đơn cho vận chuyển trước ${order.sellerShipBy.toISOString()}.`, session); reminded++;
    }
    if (order.sellerShipBy <= now && !order.fulfillmentOverdueAt) {
      order.fulfillmentOverdueAt = now;
      await notify([...admins, order.sellerId], 'ORDER', order._id, 'ship-overdue', 'Đơn đã quá hạn gửi hàng. Admin cần liên hệ hai bên; đơn không bị tự hủy.', session); escalated++;
    }
    await order.save({ session });
  });
  await Dispute.updateMany({ status: { $in: ['OPEN', 'UNDER_REVIEW'] }, reviewBy: null }, [
    { $set: { reviewBy: { $add: ['$openedAt', env.DISPUTE_REVIEW_DAYS * 86400000] } } },
  ]);
  const dueCases = { $or: [{ status: { $in: ['OPEN', 'UNDER_REVIEW'] }, reviewBy: { $lte: now } },
    { status: 'RESOLVED_BUYER', 'returnFlow.required': true, 'returnFlow.status': 'AWAITING_SHIPMENT', 'returnFlow.shipBy': { $lte: now } }] };
  const cases = await Dispute.find({ ...dueCases, deadlineEscalatedAt: null }).sort({ openedAt: 1, _id: 1 }).limit(limit);
  for (const candidate of cases) await transaction(async session => {
    const dispute = await Dispute.findOneAndUpdate({ _id: candidate._id, ...dueCases, deadlineEscalatedAt: null },
      { $set: { deadlineEscalatedAt: now }, $push: { auditHistory: { action: 'DEADLINE_ESCALATED', at: now, note: 'Quá hạn, cần admin xem xét; không tự kết luận.' } } }, { new: true, session });
    if (!dispute) return;
    await notify(admins, 'DISPUTE', dispute._id, 'escalated', 'Khiếu nại hoặc hạn gửi trả đã quá hạn. Kiểm tra hồ sơ để xử lý.', session); escalated++;
  });
  return { reminded, escalated };
};
module.exports = { run, awaiting };
