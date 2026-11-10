const Job = require('../models/backgroundJob.model');
const Outbox = require('../models/outboxEvent.model');
const Mail = require('../models/mailDelivery.model');
const Order = require('../models/order.model');
const Dispute = require('../models/dispute.model');
const ApiError = require('../utils/ApiError');
const transaction = require('../utils/withTransaction');
const audit = require('./adminAudit.service');
const env = require('../config/env');
const windowQuery = status => status === 'failed' ? { $or: [{ status: 'FAILED' }, { status: 'PROCESSING', lockedAt: { $lte: new Date(Date.now() - 5 * 60000) } }] } : {};
const list = async (kind, { page = 1, limit = 20, status } = {}, user) => {
  const models = { outbox: Outbox, mail: Mail, orders: Order, disputes: Dispute };
  const Model = models[kind]; if (!Model) throw new ApiError(404, 'Unknown operation queue');
  const now = new Date(); let query = windowQuery(status);
  if (kind === 'orders') query = { ...require('./deadline.service').awaiting, sellerShipBy: { $lte: now }, ...(user.role === 'SELLER' ? { sellerId: user._id } : {}) };
  if (kind === 'disputes') query = { $or: [{ status: { $in: ['OPEN', 'UNDER_REVIEW'] }, reviewBy: { $lte: now } },
    { status: 'RESOLVED_BUYER', 'returnFlow.status': 'AWAITING_SHIPMENT', 'returnFlow.shipBy': { $lte: now } }] };
  const projection = kind === 'outbox' ? 'type status attempts nextAttemptAt lockedAt processedAt createdAt' :
    kind === 'mail' ? 'status attempts nextAttemptAt lockedAt sentAt createdAt expiresAt lastError' : '';
  const [items, total] = await Promise.all([Model.find(query).select(projection).sort({ createdAt: 1, _id: 1 }).skip((page - 1) * limit).limit(limit), Model.countDocuments(query)]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};
const summary = async () => ({ jobs: await Job.find().select('-owner').sort({ _id: 1 }),
  smtpConfigured: require('./mail.service').configured(), backgroundJobsEnabled: env.BACKGROUND_JOBS_ENABLED,
  outboxFailed: await Outbox.countDocuments(windowQuery('failed')), mailFailed: await Mail.countDocuments(windowQuery('failed')) });
const retry = (admin, kind, id, reason) => transaction(async session => {
  const Model = kind === 'outbox' ? Outbox : kind === 'mail' ? Mail : null;
  if (!Model) throw new ApiError(400, 'Unknown retry queue');
  const conditions = windowQuery('failed');
  if (kind === 'mail') conditions.expiresAt = { $gt: new Date() };
  const item = await Model.findOneAndUpdate({ _id: id, ...conditions }, { $set: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null }, $unset: { lockedAt: 1 } }, { new: true, session });
  if (!item) throw new ApiError(409, 'Chỉ thử lại mục lỗi hoặc hết lease; email hết hạn cần gửi liên kết mới.');
  await audit.record({ admin, action: 'OPERATION_RETRY', resourceType: kind.toUpperCase(), resourceId: id, reason, session });
  return { id: item._id, status: item.status };
});
const retryJob = async (admin, id, reason) => {
  const item = await transaction(async session => {
    const now = new Date();
    const job = await Job.findOneAndUpdate({ _id: id, $or: [{ lockedUntil: { $lte: now } }, { lockedUntil: null }] }, { $set: { nextRunAt: now } }, { new: true, session });
    if (!job) throw new ApiError(409, 'Job đang chạy hoặc không tồn tại.');
    await audit.record({ admin, action: 'JOB_RETRY_REQUESTED', resourceType: 'JOB', after: { jobId: id }, reason, session });
    return job;
  });
  return { id: item._id, scheduled: true, backgroundJobsEnabled: env.BACKGROUND_JOBS_ENABLED };
};
module.exports = { list, summary, retry, retryJob };
