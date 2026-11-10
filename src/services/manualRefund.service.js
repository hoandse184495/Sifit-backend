const crypto = require('node:crypto');
const Refund = require('../models/refund.model');
const Proof = require('../models/refundProof.model');
const Payment = require('../models/payment.model');
const Receipt = require('../models/paymentTransaction.model');
const Order = require('../models/order.model');
const Group = require('../models/checkoutGroup.model');
const Commission = require('../models/commission.model');
const Payout = require('../models/sellerPayout.model');
const Dispute = require('../models/dispute.model');
const User = require('../models/user.model');
const ApiError = require('../utils/ApiError');
const transaction = require('../utils/withTransaction');
const audit = require('./adminAudit.service');
const events = require('./notificationEvent.service');
const ledger = require('./ledger.service');
const { activeRefundStatuses } = require('./refundPolicy.service');
const { reserveReference } = require('./outgoingBankTransfer.service');
const { assertReturnSatisfied } = require('./disputeReturnPolicy.service');
const adjustmentAccounting = require('./paymentExceptionAccounting.service');
const manualKinds = ['MANUAL_BANK', 'RECEIPT_ADJUSTMENT'];

const history = (refund, actor, action, note) =>
  refund.auditHistory.push({ action, actorId: actor._id, at: new Date(), note });
const assertAdmin = (admin, refund) => {
  if (
    admin.role !== 'ADMIN' ||
    [refund.buyerId, refund.sellerId, ...(refund.relatedSellerIds || [])].some(
      (id) => String(id) === String(admin._id),
    )
  )
    throw new ApiError(403, 'Cần admin không liên quan đến đơn hàng xử lý khoản hoàn.');
};
const get = async (user, id) => {
  const refund = await Refund.findOne({ _id: id, kind: { $in: manualKinds } });
  if (!refund || (user.role !== 'ADMIN' && String(refund.buyerId) !== String(user._id)))
    throw new ApiError(404, 'Không tìm thấy khoản hoàn của bạn.');
  const result = refund.toObject();
  if (user.role !== 'ADMIN' && refund.status !== 'SUCCEEDED') delete result.proof;
  return result;
};
const list = async (user, { page = 1, limit = 20, status, orderId, paymentId } = {}) => {
  const filter = {
    kind: { $in: manualKinds },
    ...(user.role !== 'ADMIN' ? { buyerId: user._id } : {}),
    ...(status ? { status } : {}),
    ...(orderId ? { orderId } : {}),
    ...(paymentId ? { paymentId } : {}),
  };
  const [items, total] = await Promise.all([
    Refund.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Refund.countDocuments(filter),
  ]);
  return {
    items: items.map((item) => {
      const value = item.toObject();
      if (user.role !== 'ADMIN' && value.status !== 'SUCCEEDED') delete value.proof;
      return value;
    }),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
};
const lockRefund = async (id, session) => {
  const refund = await Refund.findOneAndUpdate(
    { _id: id, kind: { $in: manualKinds } },
    { $inc: { __v: 1 } },
    { new: true, session },
  );
  if (!refund) throw new ApiError(404, 'Không tìm thấy khoản hoàn.');
  return refund;
};
const lockPayment = async (id, session) => {
  const payment = await Payment.findOneAndUpdate(
    { _id: id },
    { $inc: { __v: 1 } },
    { new: true, session },
  );
  if (!payment) throw new ApiError(404, 'Không tìm thấy thanh toán.');
  return payment;
};
const lockOrder = (id, session) =>
  Order.findOneAndUpdate({ _id: id }, { $inc: { settlementVersion: 1 } }, { new: true, session });
const assertFunds = async (payment, session) => {
  if (
    payment.provider !== 'payos' ||
    !['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(payment.status) ||
    payment.metadata?.exception
  )
    throw new ApiError(409, 'Cần thanh toán PayOS thành công, không có ngoại lệ đối soát.');
  const receipts = await Receipt.find({
    paymentId: payment._id,
    provider: 'payos',
    status: 'MATCHED',
  }).session(session);
  if (
    receipts.reduce((sum, receipt) => sum + receipt.amount, 0) -
      (payment.exceptionRefundedAmount || 0) !==
    payment.amount
  )
    throw new ApiError(409, 'Biên nhận ngân hàng chưa khớp số tiền thanh toán.');
};
const assertUnpaidPayout = async (orderId, session) => {
  return require('./sellerRecovery.service').assertFunded(orderId, session);
};
const notifyBuyer = (refund, actor, session, stage, body) =>
  events.enqueueNotificationEvent(
    {
      eventKey: `refund:${refund._id}:${stage}`,
      type: 'NOTIFICATION_CREATE',
      payload: {
        recipientId: refund.buyerId,
        actorId: actor._id,
        type: 'REFUND_UPDATED',
        title: 'Cập nhật hoàn tiền',
        body,
        resourceType: 'REFUND',
        resourceId: refund._id,
        eventKey: `refund:${refund._id}:${stage}`,
      },
    },
    { session },
  );
const recordAudit = (admin, refund, action, session, extra = {}) =>
  audit.record({
    admin,
    session,
    action,
    resourceType: 'REFUND',
    resourceId: refund._id,
    reason: refund.reason,
    after: { status: refund.status, orderId: refund.orderId, amount: refund.amount, ...extra },
  });

const create = (admin, data) =>
  transaction(async (session) => {
    const payment = await lockPayment(data.paymentId, session);
    const existing = await Refund.findOne({
      paymentId: payment._id,
      idempotencyKey: data.idempotencyKey,
    }).session(session);
    if (existing) {
      assertAdmin(admin, existing);
      if (
        existing.kind !== 'MANUAL_BANK' ||
        existing.amount !== data.amount ||
        String(existing.orderId) !== data.orderId ||
        existing.reason !== data.reason ||
        String(existing.disputeId || '') !== (data.disputeId || '')
      )
        throw new ApiError(409, 'Mã yêu cầu đã được dùng cho nội dung khác.');
      return existing;
    }
    const order = await lockOrder(data.orderId, session);
    if (
      !order ||
      String(order.checkoutGroupId) !== String(payment.checkoutGroupId) ||
      String(order.buyerId) !== String(payment.buyerId)
    )
      throw new ApiError(409, 'Đơn hàng không thuộc thanh toán đã chọn.');
    assertAdmin(admin, order);
    await assertFunds(payment, session);
    const recovery = await require('./sellerRecovery.service').assertFunded(order._id, session, data);
    if (
      !['PAID', 'REFUND_PENDING'].includes(order.paymentStatus) ||
      order.refundPendingAmount > 0 ||
      (await Refund.exists({
        orderId: order._id,
        kind: 'MANUAL_BANK',
        status: { $in: activeRefundStatuses },
      }).session(session))
    )
      throw new ApiError(409, 'Đơn chưa được thanh toán hoặc đang có khoản hoàn chờ xử lý.');
    if (!(await Commission.exists({ orderId: order._id, status: recovery ? { $in: ['PENDING', 'RECOGNIZED'] } : 'PENDING' }).session(session)))
      throw new ApiError(
        409,
        'Hoa hồng đã quyết toán hoặc chưa được ghi nhận, cần đối soát trước.',
      );
    if (
      data.amount > order.buyerTotal - (order.refundedAmount || 0) ||
      data.amount >
        payment.amount - (payment.refundedAmount || 0) - (payment.refundReservedAmount || 0)
    )
      throw new ApiError(409, 'Số tiền hoàn vượt số tiền còn lại của đơn hoặc thanh toán.');
    const activeCase = await Dispute.findOne({
      orderId: order._id,
      status: { $in: ['OPEN', 'UNDER_REVIEW'] },
    }).session(session);
    if (activeCase) throw new ApiError(409, 'Cần chốt kết quả khiếu nại trước khi lập khoản hoàn.');
    await assertReturnSatisfied(order._id, session);
    if (data.disputeId) {
      if (
        !(await Dispute.exists({
          _id: data.disputeId,
          orderId: order._id,
          status: 'RESOLVED_BUYER',
          refundSettledAt: null,
        }).session(session))
      )
        throw new ApiError(409, 'Khiếu nại chưa chấp nhận hoàn hoặc đã được hoàn tiền.');
    } else if (
      await Dispute.exists({
        orderId: order._id,
        status: 'RESOLVED_BUYER',
        refundSettledAt: null,
      }).session(session)
    )
      throw new ApiError(409, 'Hãy chọn khiếu nại cần hoàn để liên kết lịch sử xử lý.');
    const [refund] = await Refund.create(
      [
        {
          ...data,
          paymentId: payment._id,
          checkoutGroupId: order.checkoutGroupId,
          buyerId: order.buyerId,
          sellerId: order.sellerId,
          kind: 'MANUAL_BANK',
          provider: 'payos',
          createdBy: admin._id,
          auditHistory: [
            { action: 'CREATED', actorId: admin._id, at: new Date(), note: data.reason },
          ],
        },
      ],
      { session },
    );
    order.refundPendingAmount = data.amount;
    if (recovery) await require('../models/sellerRecovery.model').updateOne({ _id: recovery._id }, { $set: { refundId: refund._id } }, { session });
    order.paymentStatus = 'REFUND_PENDING';
    payment.refundReservedAmount = (payment.refundReservedAmount || 0) + data.amount;
    await order.save({ session });
    await payment.save({ session });
    await recordAudit(admin, refund, 'REFUND_CREATED', session);
    await notifyBuyer(
      refund,
      admin,
      session,
      'created',
      `Sifit đã duyệt khoản hoàn ${data.amount.toLocaleString('vi-VN')}đ. Vui lòng cung cấp tài khoản nhận tiền.`,
    );
    return refund;
  });

const saveBank = (buyer, id, bank) =>
  transaction(async (session) => {
    const refund = await lockRefund(id, session);
    if (buyer.role !== 'BUYER' || String(refund.buyerId) !== String(buyer._id))
      throw new ApiError(404, 'Không tìm thấy khoản hoàn của bạn.');
    if (!['REQUESTED', 'PENDING'].includes(refund.status))
      throw new ApiError(409, 'Tài khoản đã được chốt để chuyển tiền, không thể sửa.');
    refund.bank = bank;
    refund.status = 'PENDING';
    history(refund, buyer, 'BANK_SUBMITTED', 'Người mua cung cấp thông tin nhận tiền');
    await refund.save({ session });
    const admins = await User.find({ role: 'ADMIN', status: 'ACTIVE' })
      .select('_id')
      .session(session);
    for (const admin of admins)
      await events.enqueueNotificationEvent(
        {
          eventKey: `refund:${id}:bank:${refund.__v}:${admin._id}`,
          type: 'NOTIFICATION_CREATE',
          payload: {
            recipientId: admin._id,
            actorId: buyer._id,
            type: 'REFUND_UPDATED',
            title: 'Khoản hoàn chờ kiểm tra tài khoản',
            body: 'Người mua đã cung cấp thông tin nhận tiền. Vui lòng kiểm tra và duyệt chuyển khoản.',
            resourceType: 'REFUND',
            resourceId: refund._id,
            eventKey: `refund:${id}:bank:${refund.__v}`,
          },
        },
        { session },
      );
    return refund;
  });
const approve = (admin, id, expectedVersion) =>
  transaction(async (session) => {
    const refund = await lockRefund(id, session);
    assertAdmin(admin, refund);
    if (refund.status === 'APPROVED') return refund;
    if (expectedVersion !== refund.__v - 1)
      throw new ApiError(
        409,
        'Thông tin nhận tiền đã thay đổi. Hãy tải lại chi tiết và kiểm tra trước khi duyệt.',
      );
    if (refund.status !== 'PENDING' || !refund.bank?.accountNumber)
      throw new ApiError(409, 'Cần người mua cung cấp tài khoản trước khi duyệt.');
    const payment = await lockPayment(refund.paymentId, session);
    if (refund.kind === 'RECEIPT_ADJUSTMENT')
      await adjustmentAccounting.assertRefundFunds(refund, payment, session);
    else {
      await lockOrder(refund.orderId, session);
      await assertReturnSatisfied(refund.orderId, session);
      await assertFunds(payment, session);
      await assertUnpaidPayout(refund.orderId, session);
    }
    refund.status = 'APPROVED';
    refund.approvedAt = new Date();
    refund.approvedBy = admin._id;
    refund.bankSnapshot = refund.bank.toObject ? refund.bank.toObject() : { ...refund.bank };
    history(refund, admin, 'APPROVED', 'Đã kiểm tra thông tin và duyệt chuyển khoản');
    await refund.save({ session });
    await recordAudit(admin, refund, 'REFUND_APPROVED', session);
    await notifyBuyer(
      refund,
      admin,
      session,
      'approved',
      'Thông tin nhận tiền đã được chốt. Sifit đang xử lý chuyển khoản hoàn.',
    );
    return refund;
  });
const cancel = (admin, id, note) =>
  transaction(async (session) => {
    const refund = await lockRefund(id, session);
    assertAdmin(admin, refund);
    if (!['REQUESTED', 'PENDING'].includes(refund.status))
      throw new ApiError(409, 'Chỉ hủy khoản hoàn chưa duyệt chuyển khoản.');
    const payment = await lockPayment(refund.paymentId, session);
    if (refund.kind === 'RECEIPT_ADJUSTMENT') {
      await adjustmentAccounting.assertRefundFunds(refund, payment, session);
      payment.exceptionRefundReservedAmount -= refund.amount;
      await adjustmentAccounting.syncReviewState(payment, session);
      await adjustmentAccounting.recordRefundAction(
        refund,
        payment,
        admin,
        'REFUND_CANCELLED',
        note,
        session,
      );
    } else {
      const order = await lockOrder(refund.orderId, session);
      if (
        !order ||
        order.refundPendingAmount !== refund.amount ||
        payment.refundReservedAmount < refund.amount
      )
        throw new ApiError(409, 'Số dư giữ hoàn không khớp, cần đối soát.');
      order.refundPendingAmount = 0;
      order.paymentStatus = 'PAID';
      payment.refundReservedAmount -= refund.amount;
      await order.save({ session });
    }
    refund.status = 'CANCELLED';
    refund.cancelledAt = new Date();
    history(refund, admin, 'CANCELLED', note);
    await payment.save({ session });
    await refund.save({ session });
    await recordAudit(admin, refund, 'REFUND_CANCELLED', session, { note });
    await notifyBuyer(refund, admin, session, 'cancelled', `Khoản hoàn đã được hủy: ${note}`);
    return refund;
  });
const requestBankCorrection = (admin, id, note) =>
  transaction(async (session) => {
    const refund = await lockRefund(id, session);
    assertAdmin(admin, refund);
    if (!['PENDING', 'APPROVED'].includes(refund.status) || refund.proof?.sha256)
      throw new ApiError(409, 'Chỉ yêu cầu sửa tài khoản trước khi có chứng từ chuyển tiền.');
    refund.status = 'REQUESTED';
    refund.bank = undefined;
    refund.bankSnapshot = undefined;
    refund.approvedAt = undefined;
    refund.approvedBy = undefined;
    history(refund, admin, 'BANK_CORRECTION_REQUESTED', note);
    await refund.save({ session });
    await recordAudit(admin, refund, 'REFUND_BANK_CORRECTION_REQUESTED', session, { note });
    await notifyBuyer(
      refund,
      admin,
      session,
      `bank-correction:${refund.__v}`,
      `Vui lòng cung cấp lại tài khoản nhận hoàn: ${note}`,
    );
    return refund;
  });
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
  throw new ApiError(415, 'Chứng từ phải là ảnh JPEG, PNG hoặc WebP.');
};
const uploadProof = async (admin, id, file) => {
  if (!file) throw new ApiError(400, 'Cần chọn một ảnh chứng từ.');
  if (file.buffer.length > 5 * 1024 * 1024) throw new ApiError(413, 'Chứng từ tối đa 5 MB.');
  const mimeType = detectImage(file.buffer);
  const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
  return transaction(async (session) => {
    const refund = await lockRefund(id, session);
    assertAdmin(admin, refund);
    if (refund.status !== 'APPROVED')
      throw new ApiError(409, 'Chỉ tải chứng từ cho khoản hoàn đã duyệt.');
    if (refund.proof?.sha256) {
      if (refund.proof.sha256 === sha256) return refund;
      throw new ApiError(409, 'Khoản hoàn đã có chứng từ, cần đối soát trước khi đổi.');
    }
    await Proof.create([{ refundId: refund._id, data: file.buffer, mimeType, sha256 }], {
      session,
    });
    refund.proof = { mimeType, size: file.buffer.length, sha256, uploadedAt: new Date() };
    history(refund, admin, 'PROOF_UPLOADED', 'Đã lưu ảnh chứng từ riêng tư');
    await refund.save({ session });
    await recordAudit(admin, refund, 'REFUND_PROOF_UPLOADED', session, { sha256 });
    return refund;
  });
};
const getProof = async (user, id) => {
  const refund = await get(user, id);
  if (user.role !== 'ADMIN' && refund.status !== 'SUCCEEDED')
    throw new ApiError(404, 'Chứng từ chưa được ghi nhận hoàn tất.');
  const proof = await Proof.findOne({ refundId: id }).select('+data');
  if (!proof) throw new ApiError(404, 'Chưa có chứng từ.');
  return proof;
};
const completeAdjustment = async (admin, refund, payment, data, transferredAt, session) => {
  await adjustmentAccounting.assertRefundFunds(refund, payment, session);
  await reserveReference(
    {
      reference: data.reference,
      resourceType: 'REFUND',
      resourceId: refund._id,
      amount: refund.amount,
    },
    session,
  );
  refund.status = 'SUCCEEDED';
  refund.completedAt = new Date();
  refund.recordedBy = admin._id;
  refund.transferReference = data.reference;
  refund.transferNote = data.note;
  refund.transferredAt = transferredAt;
  history(refund, admin, 'TRANSFER_RECORDED', data.note);
  await refund.save({ session });
  payment.exceptionRefundedAmount = (payment.exceptionRefundedAmount || 0) + refund.amount;
  payment.exceptionRefundReservedAmount -= refund.amount;
  await adjustmentAccounting.syncReviewState(payment, session);
  await ledger.postEntry(
    {
      sourceType: 'REFUND',
      sourceId: refund.id,
      sourceEventKey: `refund:${refund._id}:transferred`,
      description: 'Verified return of unallocated bank receipts',
      lines: [
        { account: 'customer_funds_unallocated', debit: refund.amount, credit: 0, currency: 'VND' },
        { account: 'provider_clearing', debit: 0, credit: refund.amount, currency: 'VND' },
      ],
    },
    session,
  );
  await adjustmentAccounting.recordRefundAction(
    refund,
    payment,
    admin,
    'REFUND_COMPLETED',
    data.note,
    session,
  );
  await recordAudit(admin, refund, 'RECEIPT_REFUND_TRANSFER_RECORDED', session, {
    paymentId: payment._id,
    reference: data.reference,
  });
  await notifyBuyer(
    refund,
    admin,
    session,
    'completed',
    `Đã ghi nhận hoàn ${refund.amount.toLocaleString('vi-VN')}đ từ khoản tiền chưa phân bổ. Mã giao dịch ${data.reference}.`,
  );
  return refund;
};
const proportional = (amount, total, denominator) =>
  Number((BigInt(amount) * BigInt(total)) / BigInt(denominator));
const complete = (admin, id, data) =>
  transaction(async (session) => {
    const refund = await lockRefund(id, session);
    assertAdmin(admin, refund);
    if (refund.status === 'SUCCEEDED') {
      if (
        refund.transferReference === data.reference &&
        refund.amount === data.amount &&
        refund.transferNote === data.note &&
        refund.transferredAt.toISOString() === new Date(data.transferredAt).toISOString()
      )
        return refund;
      throw new ApiError(409, 'Khoản hoàn đã được ghi nhận với giao dịch khác.');
    }
    if (
      refund.status !== 'APPROVED' ||
      !refund.bankSnapshot?.accountNumber ||
      !refund.proof?.sha256 ||
      data.amount !== refund.amount ||
      !data.transferred
    )
      throw new ApiError(
        409,
        'Cần duyệt tài khoản, tải chứng từ và xác nhận đúng số tiền đã chuyển.',
      );
    const transferredAt = new Date(data.transferredAt);
    if (
      transferredAt > new Date() ||
      transferredAt.getTime() < Math.floor(refund.approvedAt.getTime() / 60000) * 60000
    )
      throw new ApiError(400, 'Thời gian chuyển phải sau lúc duyệt và không được ở tương lai.');
    const payment = await lockPayment(refund.paymentId, session);
    if (refund.kind === 'RECEIPT_ADJUSTMENT')
      return completeAdjustment(admin, refund, payment, data, transferredAt, session);
    const order = await lockOrder(refund.orderId, session);
    await assertFunds(payment, session);
    await assertReturnSatisfied(refund.orderId, session);
    const recovery = await require('./sellerRecovery.service').assertFunded(refund.orderId, session, { amount: refund.amount, disputeId: refund.disputeId });
    if (
      !order ||
      order.refundPendingAmount !== refund.amount ||
      payment.refundReservedAmount < refund.amount ||
      (order.refundedAmount || 0) + refund.amount > order.buyerTotal ||
      (payment.refundedAmount || 0) + refund.amount > payment.amount
    )
      throw new ApiError(409, 'Số dư hoàn không khớp, cần đối soát.');
    const commission = await Commission.findOne({ orderId: order._id, status: recovery ? { $in: ['PENDING', 'RECOGNIZED'] } : 'PENDING' }).session(
      session,
    );
    if (!commission || order.buyerTotal < order.sellerProceeds + order.commissionAmount)
      throw new ApiError(409, 'Hoa hồng/số dư đơn chưa sẵn sàng để hoàn.');
    const recognizedCommission = commission.status === 'RECOGNIZED';
    const cumulative = (order.refundedAmount || 0) + refund.amount;
    const merchandiseTotal = order.sellerProceeds + order.commissionAmount;
    const shippingTotal = proportional(
      order.buyerTotal - merchandiseTotal,
      cumulative,
      order.buyerTotal,
    );
    const merchandiseRefund = cumulative - shippingTotal;
    const commissionTotal = merchandiseTotal
      ? proportional(order.commissionAmount, merchandiseRefund, merchandiseTotal)
      : 0;
    const sellerTotal = merchandiseRefund - commissionTotal;
    const sellerPart = sellerTotal - (commission.refundedSellerProceeds || 0);
    const commissionPart = commissionTotal - (commission.refundedCommissionAmount || 0);
    const shippingPart = refund.amount - sellerPart - commissionPart;
    if (
      Math.min(sellerPart, commissionPart, shippingPart) < 0 ||
      sellerPart > commission.sellerProceeds ||
      commissionPart > commission.commissionAmount
    )
      throw new ApiError(409, 'Phân bổ hoàn tiền không khớp số dư hoa hồng.');
    await reserveReference(
      {
        reference: data.reference,
        resourceType: 'REFUND',
        resourceId: refund._id,
        amount: data.amount,
      },
      session,
    );
    commission.sellerProceeds -= sellerPart;
    commission.commissionAmount -= commissionPart;
    commission.refundedSellerProceeds = sellerTotal;
    commission.refundedCommissionAmount = commissionTotal;
    const fullyRefunded = cumulative === order.buyerTotal;
    if (fullyRefunded) {
      commission.status = 'REVERSED';
      commission.reversedAt = new Date();
    }
    await commission.save({ session });
    order.refundedAmount = cumulative;
    order.refundedSellerProceeds = sellerTotal;
    order.refundedCommissionAmount = commissionTotal;
    order.refundPendingAmount = 0;
    order.paymentStatus = fullyRefunded ? 'REFUNDED' : 'PAID';
    if (fullyRefunded) order.orderStatus = 'REFUNDED';
    await order.save({ session });
    payment.refundedAmount = (payment.refundedAmount || 0) + refund.amount;
    payment.refundReservedAmount -= refund.amount;
    payment.status = payment.refundedAmount === payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    await payment.save({ session });
    if (refund.disputeId)
      await Dispute.updateOne(
        { _id: refund.disputeId, orderId: order._id, status: 'RESOLVED_BUYER' },
        {
          $set: { refundSettledAt: new Date(), refundId: refund._id },
          $push: {
            auditHistory: {
              action: 'REFUND_COMPLETED',
              actorId: admin._id,
              at: new Date(),
              note: `Đã hoàn ${refund.amount} VND`,
            },
          },
        },
        { session },
      );
    const payouts = await Payout.find({
      orderIds: order._id,
      status: { $in: ['PENDING', 'ELIGIBLE'] },
    }).session(session);
    for (const payout of payouts) {
      payout.amount -= sellerPart;
      if (payout.amount < 0) throw new ApiError(409, 'Khoản chi không khớp số tiền hoàn.');
      if (fullyRefunded)
        payout.orderIds = payout.orderIds.filter((value) => String(value) !== String(order._id));
      payout.status = payout.amount === 0 ? 'CANCELLED' : 'ELIGIBLE';
      payout.refundAdjustments.push({ refundId: refund._id, amount: sellerPart, at: new Date() });
      await payout.save({ session });
    }
    const group = await Group.findById(order.checkoutGroupId).session(session);
    if (group) {
      group.paymentStatus = payment.status === 'REFUNDED' ? 'REFUNDED' : 'PAID';
      if (payment.status === 'REFUNDED') group.orderStatus = 'REFUNDED';
      await group.save({ session });
    }
    refund.status = 'SUCCEEDED';
    refund.completedAt = new Date();
    refund.recordedBy = admin._id;
    refund.transferReference = data.reference;
    refund.transferNote = data.note;
    refund.transferredAt = transferredAt;
    refund.allocation = { seller: sellerPart, commission: commissionPart, shipping: shippingPart };
    history(refund, admin, 'TRANSFER_RECORDED', data.note);
    await refund.save({ session });
    const lines = [
      {
        account: recovery ? 'seller_recovery_clearing' : 'seller_liability',
        partyId: order.sellerId,
        debit: sellerPart,
        credit: 0,
        currency: 'VND',
      },
      {
        account: recognizedCommission ? 'platform_commission_revenue' : 'platform_commission_revenue_pending',
        debit: commissionPart,
        credit: 0,
        currency: 'VND',
      },
      ...(shippingPart
        ? [{ account: 'shipping_liability', debit: shippingPart, credit: 0, currency: 'VND' }]
        : []),
      { account: 'provider_clearing', debit: 0, credit: refund.amount, currency: 'VND' },
    ];
    await ledger.postEntry(
      {
        sourceType: 'REFUND',
        sourceId: refund.id,
        sourceEventKey: `refund:${id}:transferred`,
        description: 'Manual buyer refund verified and recorded by admin',
        lines,
      },
      session,
    );
    if (recovery) await require('../models/sellerRecovery.model').updateOne({ _id: recovery._id, status: 'FUNDED', refundId: refund._id }, { $set: { status: 'REFUNDED' } }, { session });
    await recordAudit(admin, refund, 'REFUND_TRANSFER_RECORDED', session, {
      reference: data.reference,
      allocation: refund.allocation,
    });
    await notifyBuyer(
      refund,
      admin,
      session,
      'completed',
      `Đã ghi nhận hoàn ${refund.amount.toLocaleString('vi-VN')}đ, mã giao dịch ${data.reference}. Bạn có thể xem chứng từ trong chi tiết khoản hoàn.`,
    );
    await events.enqueueNotificationEvent(
      {
        eventKey: `refund:${id}:seller`,
        type: 'NOTIFICATION_CREATE',
        payload: {
          recipientId: refund.sellerId,
          actorId: admin._id,
          type: 'REFUND_UPDATED',
          title: 'Đơn hàng đã được hoàn tiền',
          body: `Đã hoàn ${refund.amount.toLocaleString('vi-VN')}đ cho đơn hàng. Số tiền chi trả đã được điều chỉnh.`,
          resourceType: 'ORDER',
          resourceId: order._id,
          eventKey: `refund:${id}:seller`,
        },
      },
      { session },
    );
    return refund;
  });
const context = async (paymentId) => {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new ApiError(404, 'Không tìm thấy thanh toán.');
  const orders = await Order.find({ checkoutGroupId: payment.checkoutGroupId }).select(
    'items buyerTotal refundedAmount refundPendingAmount paymentStatus orderStatus sellerId',
  );
  const disputes = await Dispute.find({
    orderId: { $in: orders.map((order) => order._id) },
    status: 'RESOLVED_BUYER',
    refundSettledAt: null,
  }).select('orderId status resolution');
  return { orders, disputes };
};
module.exports = {
  context,
  create,
  list,
  get,
  saveBank,
  approve,
  cancel,
  requestBankCorrection,
  uploadProof,
  getProof,
  complete,
};
