const crypto = require('node:crypto');
const Payment = require('../models/payment.model');
const Group = require('../models/checkoutGroup.model');
const Order = require('../models/order.model');
const Product = require('../models/product.model');
const Commission = require('../models/commission.model');
const Ledger = require('../models/ledgerEntry.model');
const Refund = require('../models/refund.model');
const Action = require('../models/paymentReviewAction.model');
const ApiError = require('../utils/ApiError');
const transaction = require('../utils/withTransaction');
const { createRequestFingerprint } = require('../utils/idempotency');
const accounting = require('./paymentExceptionAccounting.service');
const inventory = require('./inventoryReservation.service');
const audit = require('./adminAudit.service');
const events = require('./notificationEvent.service');

const openStates = ['OPEN', 'WAITING_TOPUP', 'REFUND_PENDING'];
const getPayment = async (user, id, session = null) => {
  const payment = await Payment.findOne({ _id: id, provider: 'payos' }).session(session);
  if (!payment || (user.role !== 'ADMIN' && String(payment.buyerId) !== String(user._id)))
    throw new ApiError(404, 'Không tìm thấy thanh toán của bạn.');
  return payment;
};
const assertAdmin = (user, payment, orders) => {
  if (
    user.role !== 'ADMIN' ||
    String(user._id) === String(payment.buyerId) ||
    orders.some((order) => String(order.sellerId) === String(user._id))
  )
    throw new ApiError(403, 'Cần admin không liên quan tới đơn hàng xử lý đối soát.');
};
const summary = (payment, balance) => {
  const amounts = { ...balance };
  delete amounts.receipts;
  return {
    _id: payment._id,
    buyerId: payment.buyerId,
    checkoutGroupId: payment.checkoutGroupId,
    amount: payment.amount,
    status: payment.status,
    createdAt: payment.createdAt,
    reviewVersion: payment.reviewVersion || 0,
    reviewState:
      payment.exceptionReviewState === 'NONE' && payment.metadata?.exception
        ? 'OPEN'
        : payment.exceptionReviewState,
    reason: balance.allocatedAmount
      ? 'EXTRA_PAYMENT'
      : balance.unallocatedAmount < payment.amount
        ? 'UNDERPAID'
        : balance.unallocatedAmount > payment.amount
          ? 'OVERPAID'
          : 'LATE_OR_INELIGIBLE',
    requiresReview:
      Boolean(payment.metadata?.exception) || openStates.includes(payment.exceptionReviewState),
    ...amounts,
  };
};
const detail = async (user, id) => {
  const payment = await getPayment(user, id);
  const balance = await accounting.totals(payment);
  const [orders, group, actions, refunds] = await Promise.all([
    Order.find({ checkoutGroupId: payment.checkoutGroupId }).select(
      'items orderStatus paymentStatus buyerTotal sellerId cancelledAt cancellationReason',
    ),
    Group.findById(payment.checkoutGroupId).select(
      'orderStatus paymentStatus reservationExpiresAt',
    ),
    Action.find({ paymentId: id })
      .sort({ createdAt: -1, _id: -1 })
      .limit(100)
      .select('-requestFingerprint -idempotencyKey'),
    Refund.find({ paymentId: id, kind: 'RECEIPT_ADJUSTMENT' })
      .select('amount status createdAt kind')
      .sort({ createdAt: -1 }),
  ]);
  return {
    payment: summary(payment, balance),
    receipts: balance.receipts,
    orders,
    group,
    actions,
    refunds,
  };
};
const list = async ({ page = 1, limit = 20, status } = {}) => {
  const query = {
    provider: 'payos',
    ...(status
      ? status === 'OPEN'
        ? {
            $or: [
              { exceptionReviewState: 'OPEN' },
              {
                exceptionReviewState: { $in: ['NONE', null] },
                'metadata.exception': { $exists: true },
              },
            ],
          }
        : { exceptionReviewState: status }
      : {
          $or: [
            { 'metadata.exception': { $exists: true } },
            { exceptionReviewState: { $in: openStates } },
          ],
        }),
  };
  const [payments, total] = await Promise.all([
    Payment.find(query)
      .sort({ updatedAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Payment.countDocuments(query),
  ]);
  const items = await Promise.all(
    payments.map(async (payment) => summary(payment, await accounting.totals(payment))),
  );
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};
const notifyBuyer = (payment, admin, session, key, body) =>
  events.enqueueNotificationEvent(
    {
      eventKey: `payment-review:${payment._id}:${key}`,
      type: 'NOTIFICATION_CREATE',
      payload: {
        recipientId: payment.buyerId,
        actorId: admin._id,
        type: 'PAYMENT_REVIEW_UPDATED',
        title: 'Cập nhật đối soát thanh toán',
        body,
        resourceType: 'PAYMENT',
        resourceId: payment._id,
        eventKey: `payment-review:${payment._id}:${key}`,
      },
    },
    { session },
  );
const cancelUnpaidGroup = async (group, orders, session) => {
  if (!group || group.paymentStatus !== 'UNPAID' || group.orderStatus !== 'PENDING_PAYMENT') return;
  if (
    orders.some(
      (order) => order.paymentStatus !== 'UNPAID' || order.orderStatus !== 'PENDING_PAYMENT',
    )
  )
    throw new ApiError(409, 'Trạng thái nhóm đơn chưa khớp, cần đối soát trước.');
  const attempts = await Payment.find({ checkoutGroupId: group._id })
    .select('_id')
    .session(session);
  if (
    await Ledger.exists({
      sourceEventKey: { $in: attempts.map((item) => `payment:${item._id}:allocated`) },
    }).session(session)
  )
    throw new ApiError(
      409,
      'Nhóm đơn đã có tiền được phân bổ, không thể hủy như đơn chưa trả tiền.',
    );
  await inventory.release(
    group._id,
    orders.flatMap((order) => order.items.map((item) => item.productId)),
    session,
  );
  group.orderStatus = 'CANCELLED';
  group.cancelledAt = new Date();
  group.cancellationReason = 'Admin xử lý hoàn khoản tiền chưa phân bổ';
  await group.save({ session });
  await Order.updateMany(
    { checkoutGroupId: group._id },
    {
      $set: {
        orderStatus: 'CANCELLED',
        cancelledAt: group.cancelledAt,
        cancellationReason: group.cancellationReason,
      },
    },
    { session },
  );
};
const decide = async (admin, id, data) =>
  transaction(async (session) => {
    const payment = await Payment.findOneAndUpdate(
      { _id: id, provider: 'payos' },
      { $inc: { __v: 1 } },
      { new: true, session },
    );
    if (!payment) throw new ApiError(404, 'Không tìm thấy thanh toán PayOS.');
    const group = await Group.findOneAndUpdate(
      { _id: payment.checkoutGroupId },
      { $inc: { paymentVersion: 1 } },
      { new: true, session },
    );
    await Order.updateMany(
      { checkoutGroupId: payment.checkoutGroupId },
      { $inc: { settlementVersion: 1 } },
      { session },
    );
    const orders = await Order.find({ checkoutGroupId: payment.checkoutGroupId })
      .sort({ _id: 1 })
      .session(session);
    assertAdmin(admin, payment, orders);
    const fingerprint = createRequestFingerprint({
      action: data.action,
      note: data.note,
      confirmStock: data.confirmStock || false,
    });
    const previous = await Action.findOne({
      paymentId: id,
      idempotencyKey: data.idempotencyKey,
    }).session(session);
    if (previous) {
      if (previous.requestFingerprint !== fingerprint)
        throw new ApiError(409, 'Mã yêu cầu đã dùng cho quyết định khác.');
      return {
        action: previous,
        ...(previous.refundId
          ? { refund: await Refund.findById(previous.refundId).session(session) }
          : {}),
      };
    }
    if (data.expectedVersion !== (payment.reviewVersion || 0))
      throw new ApiError(
        409,
        'Biên nhận hoặc quyết định đã thay đổi. Hãy tải lại hồ sơ trước khi xử lý.',
      );
    const balance = await accounting.totals(payment, session);
    if (
      !balance.receivedAmount ||
      (!payment.metadata?.exception && !openStates.includes(payment.exceptionReviewState))
    )
      throw new ApiError(409, 'Không có ngoại lệ tiền đang chờ xử lý.');
    if (balance.adjustmentReservedAmount > 0)
      throw new ApiError(409, 'Đang có khoản hoàn chờ chuyển; cần xử lý khoản hoàn đó trước.');
    const before = {
      reviewState: payment.exceptionReviewState,
      groupStatus: group?.orderStatus,
      cancellationReason: group?.cancellationReason,
      receivedAmount: balance.receivedAmount,
      allocatedAmount: balance.allocatedAmount,
    };
    let refund;
    if (data.action === 'WAIT_TOPUP') {
      if (
        balance.allocatedAmount ||
        balance.unallocatedAmount >= payment.amount ||
        !group ||
        group.orderStatus !== 'PENDING_PAYMENT' ||
        group.paymentStatus !== 'UNPAID'
      )
        throw new ApiError(409, 'Chỉ chờ bổ sung cho đơn chưa trả đủ và còn đang giữ hàng.');
      const ids = orders.flatMap((order) => order.items.map((item) => item.productId));
      const held = await Product.countDocuments({
        _id: { $in: ids },
        status: 'RESERVED',
        deletedAt: null,
        $or: [{ reservationGroupId: group._id }, { reservationGroupId: null }],
      }).session(session);
      if (!ids.length || held !== ids.length)
        throw new ApiError(409, 'Hàng không còn được giữ, cần chọn hoàn tiền hoặc kiểm tra lại.');
      payment.exceptionReviewState = 'WAITING_TOPUP';
      payment.reviewVersion = (payment.reviewVersion || 0) + 1;
      await payment.save({ session });
      await notifyBuyer(
        payment,
        admin,
        session,
        data.idempotencyKey,
        `Còn thiếu ${balance.missingAmount.toLocaleString('vi-VN')}đ. ${data.note}`.slice(0, 500),
      );
    } else if (data.action === 'ACCEPT_PAYMENT') {
      if (
        !data.confirmStock ||
        balance.allocatedAmount ||
        balance.availableAmount < payment.amount ||
        !group ||
        !['PENDING_PAYMENT', 'CANCELLED'].includes(group.orderStatus) ||
        group.paymentStatus !== 'UNPAID' ||
        !orders.length ||
        orders.some(
          (order) =>
            !['PENDING_PAYMENT', 'CANCELLED'].includes(order.orderStatus) ||
            order.paymentStatus !== 'UNPAID' ||
            String(order.buyerId) !== String(payment.buyerId),
        ) ||
        group.buyerTotal !== payment.amount ||
        orders.reduce((sum, order) => sum + order.buyerTotal, 0) !== payment.amount
      )
        throw new ApiError(409, 'Đơn hoặc số tiền chưa đủ điều kiện tiếp tục.');
      const attempts = await Payment.find({ checkoutGroupId: group._id })
        .select('_id')
        .session(session);
      if (
        (await Ledger.exists({
          sourceEventKey: { $in: attempts.map((item) => `payment:${item._id}:allocated`) },
        }).session(session)) ||
        (await Commission.exists({ orderId: { $in: orders.map((order) => order._id) } }).session(
          session,
        ))
      )
        throw new ApiError(
          409,
          'Nhóm đơn đã có phân bổ hoặc hoa hồng, không thể ghi nhận lần nữa.',
        );
      await inventory.acquireForPayment(group._id, orders, session, true);
      await require('./commission.service').createPendingForOrders(orders, session);
      await require('./ledger.service').postPaymentSuccess(
        { payment, orders, eventId: `review:${data.idempotencyKey}` },
        session,
      );
      group.orderStatus = 'PAID';
      group.paymentStatus = 'PAID';
      group.cancelledAt = undefined;
      group.cancellationReason = undefined;
      await group.save({ session });
      await Order.updateMany(
        { checkoutGroupId: group._id },
        {
          $set: { orderStatus: 'PAID', paymentStatus: 'PAID' },
          $unset: { cancelledAt: 1, cancellationReason: 1 },
        },
        { session },
      );
      payment.status = 'SUCCEEDED';
      payment.paidAt = balance.receipts.at(-1).occurredAt;
      payment.exceptionRefundOnly = false;
      await accounting.syncReviewState(payment, session);
      await notifyBuyer(
        payment,
        admin,
        session,
        data.idempotencyKey,
        'Admin đã đối soát tiền và kiểm tra hàng còn sẵn. Đơn đã được tiếp tục; phần tiền dư, nếu có, được theo dõi hoàn riêng.',
      );
      for (const order of orders)
        await events.enqueueNotificationEvent(
          {
            eventKey: `payment-review:${id}:accepted:${order._id}`,
            type: 'NOTIFICATION_CREATE',
            payload: {
              recipientId: order.sellerId,
              actorId: admin._id,
              type: 'PAYMENT_CONFIRMED',
              title: 'Đơn đã được xác nhận thanh toán sau đối soát',
              body: 'Admin đã kiểm tra biên nhận và hàng còn sẵn. Bạn có thể chuẩn bị hàng.',
              resourceType: 'ORDER',
              resourceId: order._id,
              eventKey: `payment-review:${id}:accepted:${order._id}`,
            },
          },
          { session },
        );
    } else if (data.action === 'REFUND_UNALLOCATED') {
      if (balance.availableAmount <= 0)
        throw new ApiError(409, 'Không còn tiền chưa phân bổ để hoàn.');
      if (!balance.allocatedAmount) {
        await cancelUnpaidGroup(group, orders, session);
        payment.exceptionRefundOnly = true;
      }
      const docs = await Refund.create(
        [
          {
            paymentId: payment._id,
            checkoutGroupId: payment.checkoutGroupId,
            buyerId: payment.buyerId,
            relatedSellerIds: orders.map((order) => order.sellerId),
            amount: balance.availableAmount,
            kind: 'RECEIPT_ADJUSTMENT',
            provider: 'payos',
            createdBy: admin._id,
            reason: data.note,
            idempotencyKey: data.idempotencyKey,
            auditHistory: [
              { action: 'CREATED', actorId: admin._id, at: new Date(), note: data.note },
            ],
          },
        ],
        { session },
      );
      refund = docs[0];
      payment.exceptionRefundReservedAmount =
        (payment.exceptionRefundReservedAmount || 0) + refund.amount;
      await accounting.syncReviewState(payment, session);
      await events.enqueueNotificationEvent(
        {
          eventKey: `refund:${refund._id}:created`,
          type: 'NOTIFICATION_CREATE',
          payload: {
            recipientId: payment.buyerId,
            actorId: admin._id,
            type: 'REFUND_UPDATED',
            title: 'Khoản tiền chênh lệch được duyệt hoàn',
            body: `Sifit đã duyệt hoàn ${refund.amount.toLocaleString('vi-VN')}đ chưa phân bổ cho đơn hàng. Vui lòng cung cấp tài khoản nhận tiền.`,
            resourceType: 'REFUND',
            resourceId: refund._id,
            eventKey: `refund:${refund._id}:created`,
          },
        },
        { session },
      );
    } else throw new ApiError(400, 'Quyết định đối soát không hợp lệ.');
    const after = await accounting.totals(payment, session);
    const [action] = await Action.create(
      [
        {
          paymentId: payment._id,
          adminId: admin._id,
          action: data.action,
          idempotencyKey: data.idempotencyKey,
          requestFingerprint: fingerprint,
          note: data.note,
          before,
          receivedAmount: after.receivedAmount,
          allocatedAmount: after.allocatedAmount,
          adjustmentRefundedAmount: after.adjustmentRefundedAmount,
          amount: refund?.amount || (data.action === 'ACCEPT_PAYMENT' ? payment.amount : 0),
          refundId: refund?._id,
        },
      ],
      { session },
    );
    await audit.record({
      admin,
      session,
      action: `PAYMENT_REVIEW_${data.action}`,
      resourceType: 'PAYMENT',
      resourceId: payment._id,
      reason: data.note,
      before,
      after: {
        reviewState: payment.exceptionReviewState,
        amount: action.amount,
        refundId: refund?._id,
      },
    });
    return { action, ...(refund ? { refund } : {}) };
  });
const recheck = async (admin, id) => {
  const current = await getPayment(admin, id);
  const orders = await Order.find({ checkoutGroupId: current.checkoutGroupId }).select('sellerId');
  assertAdmin(admin, current, orders);
  const claimed = await Payment.findOneAndUpdate(
    {
      _id: id,
      $or: [{ lastQueriedAt: null }, { lastQueriedAt: { $lte: new Date(Date.now() - 4000) } }],
    },
    { $set: { lastQueriedAt: new Date() } },
    { new: true },
  );
  if (!claimed) throw new ApiError(429, 'Vui lòng chờ vài giây trước khi truy vấn lại PayOS.');
  let result;
  try {
    result = await require('./paymentProviders/paymentProvider.factory')
      .getPaymentProvider('payos')
      .queryPayment(claimed);
  } catch (error) {
    if (error.statusCode) throw error;
    throw new ApiError(502, 'Chưa truy vấn được PayOS. Trạng thái tiền được giữ nguyên.');
  }
  if (result.status === 'SUCCEEDED')
    await require('./paymentWebhook.service').handleVerifiedEvent({
      providerName: 'payos',
      parsedEvent: result,
      payload: { source: 'admin-exception-recheck', result },
    });
  await transaction(async (session) => {
    const payment = await getPayment(admin, id, session);
    const balance = await accounting.totals(payment, session);
    const key = crypto.randomUUID();
    await Action.create(
      [
        {
          paymentId: payment._id,
          adminId: admin._id,
          action: 'PROVIDER_RECHECK',
          idempotencyKey: key,
          requestFingerprint: key,
          note: 'Đã truy vấn đối chiếu PayOS',
          receivedAmount: balance.receivedAmount,
          allocatedAmount: balance.allocatedAmount,
          adjustmentRefundedAmount: balance.adjustmentRefundedAmount,
        },
      ],
      { session },
    );
    await audit.record({
      admin,
      session,
      action: 'PAYMENT_REVIEW_PROVIDER_RECHECK',
      resourceType: 'PAYMENT',
      resourceId: payment._id,
      after: { receivedAmount: balance.receivedAmount, providerStatus: result.status },
    });
  });
  return detail(admin, id);
};
module.exports = { list, detail, decide, recheck };
