const crypto = require('node:crypto');
const Recovery = require('../models/sellerRecovery.model');
const Receipt = require('../models/recoveryReceipt.model');
const Order = require('../models/order.model');
const Dispute = require('../models/dispute.model');
const Payout = require('../models/sellerPayout.model');
const ApiError = require('../utils/ApiError');
const transaction = require('../utils/withTransaction');
const audit = require('./adminAudit.service');
const ledger = require('./ledger.service');
const incoming = require('./incomingTransfer.service');
const assertAdmin = (admin, order) => {
  if (admin.role !== 'ADMIN' || [order.buyerId, order.sellerId].some(id => String(id) === String(admin._id)))
    throw new ApiError(403, 'Cần admin không liên quan đến đơn xử lý thu hồi.');
};
const lockOrder = (id, session) => Order.findOneAndUpdate({ _id: id }, { $inc: { settlementVersion: 1 } }, { new: true, session });
const openLateCase = (admin, id, data) => transaction(async session => {
  const order = await lockOrder(id, session); if (!order) throw new ApiError(404, 'Không tìm thấy đơn.'); assertAdmin(admin, order);
  if (order.orderStatus !== 'COMPLETED' || order.paymentStatus !== 'PAID' || !(await Payout.exists({ orderIds: id, status: 'PAID' }).session(session)))
    throw new ApiError(409, 'Chỉ tiếp nhận bổ sung cho đơn hoàn tất, đã thanh toán và đã chi người bán.');
  if (await Dispute.exists({ orderId: id, $or: [{ status: { $in: ['OPEN', 'UNDER_REVIEW'] } }, { status: 'RESOLVED_BUYER', refundSettledAt: null }] }).session(session)) throw new ApiError(409, 'Đơn đang có khiếu nại cần xử lý.');
  const [dispute] = await Dispute.create([{ orderId: id, buyerId: order.buyerId, sellerId: order.sellerId,
    reason: 'OTHER', description: data.reason, reviewBy: new Date(Date.now() + require('../config/env').DISPUTE_REVIEW_DAYS * 86400000),
    auditHistory: [{ action: 'POST_PAYOUT_CASE_OPENED', actorId: admin._id, note: data.reason }] }], { session });
  await audit.record({ admin, action: 'POST_PAYOUT_CASE_OPENED', resourceType: 'DISPUTE', resourceId: dispute._id, reason: data.reason, session });
  return dispute;
});
const create = (admin, orderId, reason) => transaction(async session => {
  const order = await lockOrder(orderId, session); if (!order) throw new ApiError(404, 'Không tìm thấy đơn.'); assertAdmin(admin, order);
  const existing = await Recovery.findOne({ orderId }).session(session); if (existing) return existing;
  const dispute = await Dispute.findOne({ orderId, status: 'RESOLVED_BUYER', refundSettledAt: null }).session(session);
  const payout = await Payout.findOne({ orderIds: orderId, status: 'PAID' }).session(session);
  if (!dispute || !payout || payout.orderIds.length !== 1 || String(payout.sellerId) !== String(order.sellerId)) throw new ApiError(409, 'Cần quyết định hoàn cho buyer và khoản chi riêng của đơn đã PAID.');
  await require('./disputeReturnPolicy.service').assertReturnSatisfied(orderId, session);
  const requiredAmount = order.sellerProceeds - (order.refundedSellerProceeds || 0);
  if (requiredAmount !== payout.amount || requiredAmount < 0) throw new ApiError(409, 'Số chi thực tế không khớp phân bổ của đơn; cần đối soát riêng.');
  const [item] = await Recovery.create([{ orderId, disputeId: dispute._id, payoutId: payout._id, sellerId: order.sellerId, buyerId: order.buyerId,
    requiredAmount, refundAmount: order.buyerTotal - (order.refundedAmount || 0), status: requiredAmount === 0 ? 'FUNDED' : 'OPEN', createdBy: admin._id, reason }], { session });
  await audit.record({ admin, action: 'RECOVERY_OPENED', resourceType: 'RECOVERY', resourceId: item._id, reason, after: { requiredAmount }, session });
  await require('./notificationEvent.service').enqueueNotificationEvent({ eventKey: `recovery:${item._id}:opened`, type: 'NOTIFICATION_CREATE',
    payload: { recipientId: item.sellerId, type: 'SELLER_RECOVERY', title: 'Yêu cầu đối soát thu hồi tiền', body: `Admin đã mở hồ sơ thu hồi ${requiredAmount} VND. Liên hệ hỗ trợ để xác nhận thông tin trước khi chuyển tiền.`, resourceType: 'DISPUTE', resourceId: dispute._id, eventKey: `recovery:${item._id}:opened` } }, { session });
  return item;
});
const get = async (user, id) => {
  const item = await Recovery.findById(id);
  if (!item || (user.role !== 'ADMIN' && String(item.sellerId) !== String(user._id))) throw new ApiError(404, 'Không tìm thấy hồ sơ thu hồi.');
  const receipts = await Receipt.find({ recoveryId: id }).select('-proof');
  return { recovery: item, receipts };
};
const recordReceipt = async (admin, id, data, file) => {
  const b = file?.buffer;
  const mime = b?.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' :
    b?.[0] === 255 && b?.[1] === 216 && b?.[2] === 255 ? 'image/jpeg' :
    b?.subarray(0, 4).toString() === 'RIFF' && b?.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : null;
  if (!mime || !b?.length || b.length > 5 * 1024 * 1024) throw new ApiError(400, 'Cần ảnh chứng từ JPEG/PNG/WebP tối đa 5 MB.');
  const sha256 = crypto.createHash('sha256').update(b).digest('hex');
  return transaction(async session => {
    const item = await Recovery.findById(id).session(session); if (!item) throw new ApiError(404, 'Không tìm thấy hồ sơ.');
    const order = await lockOrder(item.orderId, session); if (!order) throw new ApiError(404, 'Không tìm thấy đơn.'); assertAdmin(admin, order);
    const reference = data.reference.trim().toUpperCase();
    const existing = await Receipt.findOne({ reference }).session(session);
    if (existing) {
      if (String(existing.recoveryId) === id && existing.amount === data.amount && existing.sha256 === sha256 && existing.receivedAt.toISOString() === new Date(data.receivedAt).toISOString() && existing.note === data.note) return item;
      throw new ApiError(409, 'Mã biên nhận đã dùng cho nội dung khác.');
    }
    if (await require('../models/paymentTransaction.model').exists({ reference: { $regex: `^${reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }).session(session)) throw new ApiError(409, 'Mã này đã là biên nhận thanh toán.');
    const payout = await Payout.findById(item.payoutId).session(session);
    const receivedAt = new Date(data.receivedAt);
    if (item.status !== 'OPEN' || !data.confirmed || item.receivedAmount + data.amount > item.requiredAmount || receivedAt > new Date() || receivedAt < (payout.completedAt || payout.processedAt || payout.createdAt)) throw new ApiError(409, 'Số thu, trạng thái hoặc thời điểm biên nhận không hợp lệ.');
    await incoming.reserve({ reference, sourceType: 'RECOVERY', sourceId: id, amount: data.amount }, session);
    const [receipt] = await Receipt.create([{ recoveryId: id, reference, amount: data.amount, receivedAt, note: data.note, verifiedBy: admin._id, mime, sha256, proof: b }], { session });
    item.receivedAmount += data.amount; item.status = item.receivedAmount === item.requiredAmount ? 'FUNDED' : 'OPEN'; await item.save({ session });
    await ledger.postEntry({ sourceType: 'RECOVERY', sourceId: id, sourceEventKey: `recovery-receipt:${receipt._id}`, description: 'Verified seller repayment received', lines: [
      { account: 'provider_clearing', debit: data.amount, credit: 0, currency: 'VND' },
      { account: 'seller_recovery_clearing', debit: 0, credit: data.amount, currency: 'VND', partyId: item.sellerId },
    ] }, session);
    await audit.record({ admin, action: 'RECOVERY_RECEIPT_VERIFIED', resourceType: 'RECOVERY', resourceId: item._id, reason: data.note, after: { amount: data.amount, reference }, session });
    return item;
  });
};
const assertFunded = async (orderId, session, context = {}) => {
  if (await Payout.exists({ orderIds: orderId, status: { $in: ['APPROVED', 'PROCESSING'] } }).session(session)) throw new ApiError(409, 'Khoản chi chưa đối soát xong.');
  if (!(await Payout.exists({ orderIds: orderId, status: 'PAID' }).session(session))) return null;
  const item = await Recovery.findOne({ orderId, status: 'FUNDED' }).session(session);
  if (!item || item.receivedAmount !== item.requiredAmount || (context.amount !== undefined && item.refundAmount !== context.amount) || (context.disputeId && String(item.disputeId) !== String(context.disputeId)))
    throw new ApiError(409, 'Đơn đã chi trả: cần hồ sơ thu hồi đủ tiền và hoàn đúng toàn bộ số dư còn lại.');
  if (context.amount !== undefined && String(item.disputeId) !== String(context.disputeId || '')) throw new ApiError(409, 'Cần liên kết đúng khiếu nại sau chi trả.');
  return item;
};
module.exports = { openLateCase, create, get, recordReceipt, assertFunded };
