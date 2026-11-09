const mongoose = require('mongoose');
const ProductReport = require('../models/productReport.model');
const Product = require('../models/product.model');
const User = require('../models/user.model');
const ApiError = require('../utils/ApiError');
const audit = require('./adminAudit.service');
const notifications = require('./notificationEvent.service');
const logger = require('../utils/logger');

const inTransaction = async (action) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await action(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};
const queue = (session, { recipientId, actorId, type, title, body, resourceId, key }) =>
  notifications.enqueueNotificationEvent(
    {
      eventKey: key,
      type: 'NOTIFICATION_CREATE',
      payload: {
        recipientId,
        actorId,
        type,
        title,
        body: body.slice(0, 500),
        resourceType: 'PRODUCT',
        resourceId,
        eventKey: key,
      },
    },
    { session },
  );
// Best effort immediate delivery; committed outbox events remain retryable by the existing worker.
const deliver = async (eventKeys) => {
  try {
    await notifications.processBatch({ limit: eventKeys.length, eventKeys });
  } catch (_error) {
    logger.warn('Product report notifications remain queued for delivery');
  }
};

const createReport = async (user, productId, data) => {
  try {
    return await inTransaction(async (session) => {
      // Serialize submissions by account before counting, including across API processes.
      const reporter = await User.findOneAndUpdate(
        { _id: user._id, status: 'ACTIVE' },
        { $inc: { productReportVersion: 1 } },
        { new: true, session },
      ).select('+reportingBlockedUntil');
      if (!reporter) throw new ApiError(403, 'Tài khoản không khả dụng.');
      const now = new Date();
      if (reporter.reportingBlockedUntil > now)
        throw new ApiError(
          403,
          `Quyền báo cáo của bạn tạm khóa đến ${reporter.reportingBlockedUntil.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}.`,
        );
      if (
        await ProductReport.exists({ reporterId: user._id, productId, status: 'OPEN' }).session(
          session,
        )
      )
        throw new ApiError(409, 'Bạn đã báo cáo sản phẩm này. Vui lòng chờ quản trị viên xử lý.');
      const product = await Product.findOne({
        _id: productId,
        status: 'ACTIVE',
        deletedAt: null,
      }).session(session);
      if (!product) throw new ApiError(404, 'Sản phẩm không còn khả dụng để báo cáo.');
      if (String(product.sellerId) === String(user._id))
        throw new ApiError(403, 'Bạn không thể báo cáo sản phẩm của chính mình.');
      const recent = { reporterId: user._id, createdAt: { $gt: new Date(now - 10 * 60 * 1000) } };
      if ((await ProductReport.countDocuments(recent).session(session)) >= 3)
        throw new ApiError(429, 'Bạn đã gửi 3 báo cáo trong 10 phút. Vui lòng thử lại sau.');
      recent.createdAt.$gt = new Date(now - 24 * 60 * 60 * 1000);
      if ((await ProductReport.countDocuments(recent).session(session)) >= 10)
        throw new ApiError(429, 'Bạn đã gửi 10 báo cáo trong 24 giờ. Vui lòng thử lại sau.');
      const [report] = await ProductReport.create(
        [
          {
            reporterId: user._id,
            productId,
            sellerId: product.sellerId,
            ...data,
            productSnapshot: {
              title: product.title,
              description: product.description,
              price: product.price,
              images: product.images.map((image) => ({ url: image.url })),
              brand: product.brand,
              status: product.status,
            },
          },
        ],
        { session },
      );
      return report;
    });
  } catch (error) {
    if (error.code === 11000)
      throw new ApiError(409, 'Bạn đã báo cáo sản phẩm này. Vui lòng chờ quản trị viên xử lý.');
    throw error;
  }
};

const list = async ({ page = 1, limit = 20, ...filter }, admin = false) => {
  let query = ProductReport.find(filter)
    .sort({ createdAt: admin ? 1 : -1, _id: admin ? 1 : -1 })
    .skip((page - 1) * limit)
    .limit(limit);
  if (admin)
    query = query
      .populate({
        path: 'productId',
        select: 'title description images price status hiddenAt hiddenBy deletedAt',
      })
      .populate({ path: 'sellerId', select: 'fullName' })
      .populate({ path: 'resolvedBy', select: 'fullName' })
      .populate({
        path: 'reporterId',
        select: 'fullName email +reportingBlockedUntil +reportingWarning',
      });
  // Selected reporter restrictions are intentionally visible to admins only.
  const items = await query.lean();
  const total = await ProductReport.countDocuments(filter);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const resolveReport = async (admin, id, { decision, note }) => {
  const result = await inTransaction(async (session) => {
    const report = await ProductReport.findOne({ _id: id, status: 'OPEN' }).session(session);
    if (!report)
      throw new ApiError(409, 'Báo cáo đã được xử lý hoặc không tồn tại. Hãy tải lại danh sách.');
    if ([report.sellerId, report.reporterId].some((userId) => String(userId) === String(admin._id)))
      throw new ApiError(403, 'Cần quản trị viên khác xử lý báo cáo liên quan đến bạn.');
    if (decision === 'HIDE') {
      const before = await Product.findOneAndUpdate(
        {
          _id: report.productId,
          status: { $in: ['ACTIVE', 'PENDING', 'REJECTED'] },
          deletedAt: null,
        },
        {
          $set: {
            status: 'ARCHIVED',
            hiddenAt: new Date(),
            hiddenBy: admin._id,
            rejectionReason: note,
          },
        },
        { new: false, session },
      );
      if (!before)
        throw new ApiError(
          409,
          'Không thể ẩn sản phẩm ở trạng thái hiện tại. Hãy kiểm tra lại sản phẩm; báo cáo vẫn chưa được đóng.',
        );
      await audit.record({
        admin,
        session,
        action: 'PRODUCT_HIDDEN',
        resourceType: 'PRODUCT',
        resourceId: report.productId,
        reason: note,
        before: { status: before.status },
        after: { status: 'ARCHIVED', reportId: report._id },
      });
      await queue(session, {
        recipientId: report.sellerId,
        actorId: admin._id,
        type: 'PRODUCT_HIDDEN',
        title: 'Sản phẩm đã bị ẩn sau khi kiểm tra',
        body: `${report.productSnapshot.title}: ${note}`,
        resourceId: report.productId,
        key: `product-report:${id}:seller`,
      });
    }
    report.status = 'RESOLVED';
    report.decision = decision;
    report.resolutionNote = note;
    report.resolvedBy = admin._id;
    report.resolvedAt = new Date();
    await report.save({ session });
    await audit.record({
      admin,
      session,
      action: 'PRODUCT_REPORT_RESOLVED',
      resourceType: 'PRODUCT_REPORT',
      resourceId: report._id,
      reason: note,
      before: { status: 'OPEN' },
      after: { status: report.status, decision, productId: report.productId },
    });
    await queue(session, {
      recipientId: report.reporterId,
      actorId: admin._id,
      type: 'PRODUCT_REPORT_RESOLVED',
      title: 'Báo cáo sản phẩm đã được xử lý',
      body: `${report.productSnapshot.title}: ${decision === 'HIDE' ? 'Sản phẩm đã bị ẩn.' : 'Chưa đủ cơ sở xác nhận vi phạm.'} ${note}`,
      resourceId: report.productId,
      key: `product-report:${id}:reporter`,
    });
    return report;
  });
  await deliver([`product-report:${id}:seller`, `product-report:${id}:reporter`]);
  return result;
};

const moderateReporter = async (admin, id, { action, note, days }) => {
  const result = await inTransaction(async (session) => {
    const report = await ProductReport.findById(id).session(session);
    if (!report) throw new ApiError(404, 'Không tìm thấy báo cáo.');
    if (
      String(report.reporterId) === String(admin._id) ||
      String(report.sellerId) === String(admin._id)
    )
      throw new ApiError(403, 'Cần quản trị viên khác xử lý trường hợp liên quan đến bạn.');
    const user = await User.findById(report.reporterId)
      .select('+reportingBlockedUntil +reportingWarning')
      .session(session);
    if (!user || user.role === 'ADMIN')
      throw new ApiError(409, 'Không thể thay đổi quyền báo cáo của tài khoản này.');
    const before = { blockedUntil: user.reportingBlockedUntil, warning: user.reportingWarning };
    if (action === 'BLOCK')
      user.reportingBlockedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    if (action === 'UNBLOCK') user.reportingBlockedUntil = undefined;
    if (action === 'WARN' || action === 'BLOCK') user.reportingWarning = note;
    await user.save({ session });
    const after = {
      blockedUntil: user.reportingBlockedUntil || null,
      warning: user.reportingWarning || '',
    };
    const entry = await audit.record({
      admin,
      session,
      action: `PRODUCT_REPORTER_${action}`,
      resourceType: 'USER',
      resourceId: user._id,
      reason: note,
      before,
      after,
    });
    await queue(session, {
      recipientId: user._id,
      actorId: admin._id,
      type: 'REPORTING_POLICY',
      title:
        action === 'BLOCK'
          ? 'Quyền báo cáo sản phẩm tạm khóa'
          : action === 'UNBLOCK'
            ? 'Quyền báo cáo sản phẩm đã mở lại'
            : 'Nhắc nhở về báo cáo sản phẩm',
      body: `${note}${action === 'BLOCK' ? ` Thời hạn: ${days} ngày.` : ''}`,
      resourceId: report.productId,
      key: `reporting-policy:${entry._id}`,
    });
    return { policy: after, eventKey: `reporting-policy:${entry._id}` };
  });
  await deliver([result.eventKey]);
  return result.policy;
};
module.exports = { createReport, list, resolveReport, moderateReporter };
