const crypto = require('node:crypto');
const Dispute = require('../models/dispute.model');
const Order = require('../models/order.model');
const Evidence = require('../models/disputeEvidence.model');
const Message = require('../models/disputeMessage.model');
const User = require('../models/user.model');
const ApiError = require('../utils/ApiError');
const transaction = require('../utils/withTransaction');
const events = require('./notificationEvent.service');
const audit = require('./adminAudit.service');

const canAccess = (dispute, user) =>
  user.role === 'ADMIN' ||
  [dispute.buyerId, dispute.sellerId].some((id) => String(id) === String(user._id));
const getCase = async (id, user, session = null) => {
  const dispute = await Dispute.findById(id).session(session);
  if (!dispute || !canAccess(dispute, user))
    throw new ApiError(404, 'Không tìm thấy khiếu nại của bạn.');
  return dispute;
};
const lockCase = async (id, user, session) => {
  const initial = await getCase(id, user, session);
  const order = await Order.findOneAndUpdate(
    { _id: initial.orderId },
    { $inc: { settlementVersion: 1 } },
    { new: true, session },
  );
  if (!order) throw new ApiError(404, 'Không tìm thấy đơn hàng.');
  return Dispute.findOneAndUpdate({ _id: id }, { $inc: { __v: 1 } }, { new: true, session });
};
const assertIndependentAdmin = (dispute, user) => {
  if (
    user.role !== 'ADMIN' ||
    [dispute.buyerId, dispute.sellerId].some((id) => String(id) === String(user._id))
  )
    throw new ApiError(403, 'Cần admin không liên quan đến đơn kiểm tra vụ việc.');
};
const canContribute = (dispute) =>
  ['OPEN', 'UNDER_REVIEW'].includes(dispute.status) ||
  (dispute.status === 'RESOLVED_BUYER' &&
    dispute.returnFlow?.required &&
    dispute.returnFlow.status !== 'VERIFIED' &&
    !dispute.refundSettledAt);
const assertContribute = (dispute) => {
  if (!canContribute(dispute))
    throw new ApiError(409, 'Khiếu nại đã chốt, không còn nhận thêm nội dung.');
};
const actorRole = (dispute, user) =>
  String(dispute.buyerId) === String(user._id)
    ? 'BUYER'
    : String(dispute.sellerId) === String(user._id)
      ? 'SELLER'
      : 'ADMIN';
const addHistory = (dispute, user, action, note) => {
  dispute.contentVersion = (dispute.contentVersion || 0) + 1;
  dispute.auditHistory.push({ action, actorId: user._id, note, at: new Date() });
};
const notify = async (dispute, user, session, stage, body, includeAdmins = false) => {
  const recipients = [dispute.buyerId, dispute.sellerId];
  if (includeAdmins)
    recipients.push(
      ...(await User.find({ role: 'ADMIN', status: 'ACTIVE' }).select('_id').session(session)).map(
        (user) => user._id,
      ),
    );
  for (const recipientId of new Set(recipients.map(String))) {
    if (recipientId === String(user._id)) continue;
    await events.enqueueNotificationEvent(
      {
        eventKey: `dispute:${dispute._id}:${stage}:${recipientId}`,
        type: 'NOTIFICATION_CREATE',
        payload: {
          recipientId,
          actorId: user._id,
          type: 'DISPUTE_UPDATED',
          title: 'Cập nhật khiếu nại và trả hàng',
          body,
          resourceType: 'DISPUTE',
          resourceId: dispute._id,
          eventKey: `dispute:${dispute._id}:${stage}:${recipientId}`,
        },
      },
      { session },
    );
  }
};
const listMessages = async (user, id, { page = 1, limit = 20 } = {}) => {
  await getCase(id, user);
  const filter = { disputeId: id };
  const [items, total] = await Promise.all([
    Message.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('authorId', 'fullName avatar'),
    Message.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};
const postMessage = (user, id, { body, idempotencyKey }) =>
  transaction(async (session) => {
    const dispute = await lockCase(id, user, session);
    const existing = await Message.findOne({
      disputeId: id,
      authorId: user._id,
      idempotencyKey,
    }).session(session);
    if (existing) {
      if (existing.body !== body) throw new ApiError(409, 'Mã yêu cầu đã dùng cho nội dung khác.');
      return existing;
    }
    assertContribute(dispute);
    if (
      (dispute.messageCount || 0) >= 100 ||
      (await Message.countDocuments({
        disputeId: id,
        authorId: user._id,
        createdAt: { $gte: new Date(Date.now() - 86400000) },
      }).session(session)) >= 20
    )
      throw new ApiError(429, 'Đã đạt giới hạn phản hồi. Vui lòng chờ admin xử lý.');
    const [message] = await Message.create(
      [
        {
          disputeId: id,
          authorId: user._id,
          authorRole: actorRole(dispute, user),
          body,
          idempotencyKey,
        },
      ],
      { session },
    );
    dispute.messageCount = (dispute.messageCount || 0) + 1;
    addHistory(dispute, user, 'MESSAGE_ADDED', 'Đã bổ sung phản hồi');
    await dispute.save({ session });
    await notify(
      dispute,
      user,
      session,
      `message:${message._id}`,
      'Có phản hồi mới trong khiếu nại. Mở chi tiết để xem nội dung.',
      true,
    );
    return message;
  });
const listEvidence = async (user, id) => {
  await getCase(id, user);
  return {
    items: await Evidence.find({ disputeId: id })
      .sort({ createdAt: 1, _id: 1 })
      .populate('authorId', 'fullName avatar'),
  };
};
const detectImage = (buffer) => {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
    return 'image/jpeg';
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  throw new ApiError(415, 'Bằng chứng phải là ảnh JPEG, PNG hoặc WebP.');
};
const uploadEvidence = async (user, id, file, { caption, category }) => {
  if (!file) throw new ApiError(400, 'Cần chọn một ảnh bằng chứng.');
  if (file.buffer.length > 5 * 1024 * 1024) throw new ApiError(413, 'Ảnh tối đa 5 MB.');
  const mimeType = detectImage(file.buffer);
  const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
  return transaction(async (session) => {
    const dispute = await lockCase(id, user, session);
    const existing = await Evidence.findOne({ disputeId: id, authorId: user._id, sha256 }).session(
      session,
    );
    if (existing) {
      if (existing.caption !== caption || existing.category !== category)
        throw new ApiError(409, 'Ảnh đã có trong vụ việc với mô tả khác.');
      return existing;
    }
    assertContribute(dispute);
    if (category !== 'GENERAL' && !dispute.returnFlow?.required)
      throw new ApiError(409, 'Đơn chưa được yêu cầu trả hàng.');
    // Reserve a separate quota for return receipts; product-photo spam must not
    // prevent the buyer from documenting a return after the admin decision.
    const pool =
      category === 'GENERAL' ? 'GENERAL' : { $in: ['RETURN_SHIPPING', 'RETURN_RECEIPT'] };
    const perActorLimit = category === 'GENERAL' ? 10 : 5;
    const poolLimit = category === 'GENERAL' ? 20 : 10;
    if (
      (dispute.evidenceCount || 0) >= 30 ||
      (await Evidence.countDocuments({ disputeId: id, category: pool }).session(session)) >=
        poolLimit ||
      (await Evidence.countDocuments({ disputeId: id, authorId: user._id, category: pool }).session(
        session,
      )) >= perActorLimit
    )
      throw new ApiError(
        429,
        'Đã đạt giới hạn ảnh cho bước này: 10 ảnh sản phẩm hoặc 5 ảnh trả hàng mỗi người gửi.',
      );
    const [evidence] = await Evidence.create(
      [
        {
          disputeId: id,
          authorId: user._id,
          authorRole: actorRole(dispute, user),
          caption,
          category,
          mimeType,
          size: file.buffer.length,
          sha256,
          data: file.buffer,
        },
      ],
      { session },
    );
    dispute.evidenceCount = (dispute.evidenceCount || 0) + 1;
    addHistory(dispute, user, 'EVIDENCE_ADDED', 'Đã bổ sung ảnh bằng chứng');
    await dispute.save({ session });
    await notify(
      dispute,
      user,
      session,
      `evidence:${evidence._id}`,
      'Có ảnh bằng chứng mới trong khiếu nại. Ảnh được lưu riêng tư.',
      true,
    );
    return Evidence.findById(evidence._id).session(session);
  });
};
const getEvidenceFile = async (user, id, fileId) => {
  await getCase(id, user);
  const file = await Evidence.findOne({ _id: fileId, disputeId: id }).select('+data');
  if (!file) throw new ApiError(404, 'Không tìm thấy ảnh bằng chứng.');
  return file;
};
const assertVersion = (dispute, expectedVersion) => {
  if ((dispute.contentVersion || 0) !== expectedVersion)
    throw new ApiError(409, 'Vụ việc đã có cập nhật. Hãy tải lại và kiểm tra nội dung mới.');
};
const submitReturnShipment = (buyer, id, { expectedVersion, ...shipment }) =>
  transaction(async (session) => {
    const dispute = await lockCase(id, buyer, session);
    if (String(dispute.buyerId) !== String(buyer._id))
      throw new ApiError(403, 'Chỉ người mua được khai báo vận đơn trả.');
    const flow = dispute.returnFlow;
    if (
      !flow?.required ||
      dispute.status !== 'RESOLVED_BUYER' ||
      !['AWAITING_SHIPMENT', 'SHIPPED'].includes(flow.status)
    )
      throw new ApiError(409, 'Đơn không còn ở bước gửi trả hàng.');
    if (
      flow.shipment?.trackingNumber === shipment.trackingNumber &&
      flow.shipment?.carrierName === shipment.carrierName
    ) {
      if (
        flow.shipment.note === shipment.note &&
        flow.shipment.shippedAt.toISOString() === new Date(shipment.shippedAt).toISOString() &&
        (flow.shipment.trackingUrl || '') === (shipment.trackingUrl || '')
      )
        return dispute;
    }
    assertVersion(dispute, expectedVersion);
    if (dispute.auditHistory.filter((entry) => entry.action === 'RETURN_SHIPPED').length >= 10)
      throw new ApiError(
        429,
        'Vận đơn đã được cập nhật nhiều lần. Hãy phản hồi để admin kiểm tra.',
      );
    const shippedAt = new Date(shipment.shippedAt);
    if (
      shippedAt > new Date() ||
      shippedAt.getTime() < Math.floor(flow.requestedAt.getTime() / 60000) * 60000
    )
      throw new ApiError(400, 'Thời gian gửi trả không hợp lệ.');
    flow.status = 'SHIPPED';
    flow.shipment = { ...shipment, submittedAt: new Date() };
    addHistory(
      dispute,
      buyer,
      'RETURN_SHIPPED',
      `Đã khai báo vận đơn trả: ${shipment.carrierName} · ${shipment.trackingNumber}`,
    );
    await dispute.save({ session });
    await notify(
      dispute,
      buyer,
      session,
      `return-shipped:${dispute.contentVersion}`,
      'Người mua đã gửi thông tin vận đơn trả hàng.',
      true,
    );
    return dispute;
  });
const confirmReturnReceipt = (seller, id, { expectedVersion, note }) =>
  transaction(async (session) => {
    const dispute = await lockCase(id, seller, session);
    if (String(dispute.sellerId) !== String(seller._id))
      throw new ApiError(403, 'Chỉ người bán được xác nhận nhận lại hàng.');
    if (!dispute.returnFlow?.required || dispute.status !== 'RESOLVED_BUYER')
      throw new ApiError(409, 'Đơn không ở quy trình trả hàng.');
    if (['SELLER_RECEIVED', 'VERIFIED'].includes(dispute.returnFlow.status)) {
      if (dispute.returnFlow.sellerReceipt?.note === note) return dispute;
      throw new ApiError(409, 'Việc nhận lại hàng đã được ghi nhận, không thể ghi đè.');
    }
    assertVersion(dispute, expectedVersion);
    if (dispute.returnFlow.status !== 'SHIPPED')
      throw new ApiError(409, 'Chưa có vận đơn trả hàng.');
    dispute.returnFlow.status = 'SELLER_RECEIVED';
    dispute.returnFlow.sellerReceipt = { receivedAt: new Date(), confirmedBy: seller._id, note };
    addHistory(dispute, seller, 'RETURN_RECEIVED_BY_SELLER', note);
    await dispute.save({ session });
    await notify(
      dispute,
      seller,
      session,
      'return-received',
      'Người bán xác nhận đã nhận lại hàng. Chờ admin kiểm tra trước khi hoàn tiền.',
      true,
    );
    return dispute;
  });
const verifyReturn = (admin, id, { expectedVersion, note, overrideSellerConfirmation }) =>
  transaction(async (session) => {
    const dispute = await lockCase(id, admin, session);
    assertIndependentAdmin(dispute, admin);
    if (!dispute.returnFlow?.required || dispute.status !== 'RESOLVED_BUYER')
      throw new ApiError(409, 'Đơn không ở quy trình trả hàng.');
    if (dispute.returnFlow.status === 'VERIFIED') {
      if (dispute.returnFlow.verification?.note === note) return dispute;
      throw new ApiError(409, 'Kết quả xác minh trả hàng đã được chốt.');
    }
    assertVersion(dispute, expectedVersion);
    const status = dispute.returnFlow.status;
    if (status !== 'SELLER_RECEIVED') {
      if (
        status !== 'SHIPPED' ||
        !overrideSellerConfirmation ||
        note.length < 30 ||
        !(await Evidence.exists({
          disputeId: id,
          category: { $in: ['RETURN_SHIPPING', 'RETURN_RECEIPT'] },
        }).session(session))
      )
        throw new ApiError(
          409,
          'Cần người bán xác nhận nhận lại; trường hợp ngoại lệ cần bằng chứng giao trả và căn cứ ít nhất 30 ký tự.',
        );
    }
    dispute.returnFlow.status = 'VERIFIED';
    dispute.returnFlow.verification = {
      verifiedAt: new Date(),
      adminId: admin._id,
      note,
      overrideSellerConfirmation: status !== 'SELLER_RECEIVED',
    };
    addHistory(dispute, admin, 'RETURN_VERIFIED', note);
    await dispute.save({ session });
    await audit.record({
      admin,
      session,
      action: 'DISPUTE_RETURN_VERIFIED',
      resourceType: 'DISPUTE',
      resourceId: dispute._id,
      reason: note,
      after: { returnStatus: 'VERIFIED', overrideSellerConfirmation: status !== 'SELLER_RECEIVED' },
    });
    await notify(
      dispute,
      admin,
      session,
      'return-verified',
      'Admin đã kiểm tra việc nhận lại hàng. Đơn có thể tiếp tục bước duyệt hoàn tiền.',
    );
    return dispute;
  });
module.exports = {
  getCase,
  lockCase,
  assertIndependentAdmin,
  canContribute,
  assertVersion,
  notify,
  listMessages,
  postMessage,
  listEvidence,
  uploadEvidence,
  getEvidenceFile,
  submitReturnShipment,
  confirmReturnReceipt,
  verifyReturn,
};
