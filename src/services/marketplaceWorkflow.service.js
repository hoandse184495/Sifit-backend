const crypto = require('crypto');
const Order = require('../models/order.model');
const Shipment = require('../models/shipment.model');
const Address = require('../models/address.model');
const Dispute = require('../models/dispute.model');
const SellerProfile = require('../models/sellerProfile.model');
const BankAccount = require('../models/sellerBankAccount.model');
const Payout = require('../models/sellerPayout.model');
const Commission = require('../models/commission.model');
const ApiError = require('../utils/ApiError');
const transaction = require('../utils/withTransaction');
const audit = require('./adminAudit.service');
const notifications = require('./notificationEvent.service');
const ledger = require('./ledger.service');

const notify = (
  session,
  { recipientId, type, title, body, resourceType, resourceId, key, actorId },
) =>
  notifications.enqueueNotificationEvent(
    {
      eventKey: key,
      type: 'NOTIFICATION_CREATE',
      payload: { recipientId, actorId, type, title, body, resourceType, resourceId, eventKey: key },
    },
    { session },
  );
const assertNoFinancialHold = async (order, session) => {
  if (
    await Dispute.exists({
      orderId: order._id,
      $or: [
        { status: { $in: ['OPEN', 'UNDER_REVIEW'] } },
        { status: 'RESOLVED_BUYER', refundSettledAt: null },
      ],
    }).session(session)
  )
    throw new ApiError(
      409,
      'Đơn có khiếu nại hoặc quyết định hoàn tiền, chưa thể hoàn tất hoặc chi trả.',
    );
  if (await require('./refundPolicy.service').hasRefundHold(order, session))
    throw new ApiError(409, 'Thanh toán có khoản hoàn hoặc ngoại lệ cần đối soát trước.');
};
const getBank = (seller) => BankAccount.findOne({ sellerId: seller._id });
const saveBank = (seller, body) =>
  transaction(async (session) => {
    // Serialize bank edits with payout snapshot approval on the same seller account.
    await require('../models/user.model').updateOne(
      { _id: seller._id },
      { $inc: { __v: 1 } },
      { session },
    );
    const oldBank = await BankAccount.findOne({ sellerId: seller._id }).session(session);
    const bank = await BankAccount.findOneAndUpdate(
      { sellerId: seller._id },
      { $set: body },
      { new: true, upsert: true, runValidators: true, session },
    );
    await require('./sellerVerification.service').invalidateBank(seller, oldBank, bank, session);
    return bank;
  });
const acceptOrder = (seller, id) =>
  transaction(async (session) => {
    const order = await Order.findOneAndUpdate(
      { _id: id, sellerId: seller._id, paymentStatus: 'PAID', orderStatus: 'PAID' },
      {
        $set: { orderStatus: 'PROCESSING', sellerAcceptedAt: new Date() },
        $inc: { settlementVersion: 1 },
      },
      { new: true, session },
    );
    if (!order) throw new ApiError(409, 'Chỉ xác nhận đơn đã thanh toán thuộc cửa hàng của bạn.');
    await notify(session, {
      recipientId: order.buyerId,
      actorId: seller._id,
      type: 'ORDER_ACCEPTED',
      title: 'Người bán đang chuẩn bị hàng',
      body: 'Người bán đã xác nhận đơn và sẽ đặt vận chuyển.',
      resourceType: 'ORDER',
      resourceId: order._id,
      key: `order:${id}:accepted`,
    });
    return order;
  });
const completeOrder = (admin, id, { note, allowUnconfirmed }) =>
  transaction(async (session) => {
    const order = await Order.findOneAndUpdate(
      { _id: id, orderStatus: { $in: ['DELIVERED', 'COMPLETED'] } },
      { $inc: { settlementVersion: 1 } },
      { new: true, session },
    );
    if (!order || order.paymentStatus !== 'PAID' || !order.deliveredAt)
      throw new ApiError(409, 'Đơn chưa được xác nhận thanh toán và giao hàng.');
    if ([order.buyerId, order.sellerId].some((id) => String(id) === String(admin._id)))
      throw new ApiError(403, 'Cần admin khác kiểm tra đơn liên quan đến bạn.');
    if (order.orderStatus === 'COMPLETED') return order;
    await assertNoFinancialHold(order, session);
    if (
      !order.buyerConfirmedAt &&
      !(allowUnconfirmed && order.protectionEndsAt && order.protectionEndsAt <= new Date())
    )
      throw new ApiError(
        409,
        'Cần người mua xác nhận nhận hàng; trường hợp quá hạn cần admin ghi căn cứ và chọn xử lý khi người mua chưa xác nhận.',
      );
    order.orderStatus = 'COMPLETED';
    order.completedAt = new Date();
    order.completedBy = admin._id;
    order.completionNote = note;
    await order.save({ session });
    await audit.record({
      admin,
      session,
      action: 'ORDER_COMPLETED',
      resourceType: 'ORDER',
      resourceId: order._id,
      reason: note,
      before: { status: 'DELIVERED' },
      after: { status: 'COMPLETED', buyerConfirmedAt: order.buyerConfirmedAt, allowUnconfirmed },
    });
    for (const recipientId of [order.buyerId, order.sellerId])
      await notify(session, {
        recipientId,
        actorId: admin._id,
        type: 'ORDER_COMPLETED',
        title: 'Đơn hàng đã được admin duyệt hoàn tất',
        body: 'Đơn đã hoàn tất. Chi trả được theo dõi riêng và chỉ thực hiện khi hết thời hạn bảo vệ, không có khiếu nại.',
        resourceType: 'ORDER',
        resourceId: order._id,
        key: `order:${id}:completed:${recipientId}`,
      });
    return order;
  });
const snapshotAddress = (address) => ({
  recipientName: address.recipientName,
  phone: address.phone,
  addressLine: address.addressLine,
  ward: address.ward,
  province: address.province || address.city,
});
const manualShipment = (seller, orderId, data) =>
  transaction(async (session) => {
    const order = await Order.findOneAndUpdate(
      {
        _id: orderId,
        sellerId: seller._id,
        paymentStatus: 'PAID',
        orderStatus: { $in: ['PAID', 'PROCESSING'] },
      },
      { $inc: { settlementVersion: 1 } },
      { new: true, session },
    );
    if (!order) throw new ApiError(409, 'Đơn chưa thanh toán, đã gửi hoặc không thuộc cửa hàng.');
    const old = await Shipment.findOne({
      orderId,
      status: { $nin: ['CANCELLED', 'RETURNED', 'DELIVERY_FAILED'] },
    }).session(session);
    if (old) {
      if (old.trackingNumber !== data.trackingNumber || old.carrierName !== data.carrierName)
        throw new ApiError(409, 'Đơn đã có vận đơn khác.');
      return old;
    }
    const address = await Address.findOne({
      _id: data.pickupAddressId,
      userId: seller._id,
      isActive: true,
      addressType: { $in: ['PICKUP', 'BOTH'] },
    }).session(session);
    if (!address) throw new ApiError(400, 'Địa chỉ lấy hàng không hợp lệ.');
    if (!(await SellerProfile.exists({ userId: seller._id, status: 'ACTIVE' }).session(session)))
      throw new ApiError(409, 'Cần hồ sơ cửa hàng đang hoạt động.');
    const [shipment] = await Shipment.create(
      [
        {
          ...data,
          orderId,
          sellerId: seller._id,
          buyerId: order.buyerId,
          provider: 'manual',
          providerShipmentId: `manual_${crypto.randomUUID()}`,
          pickupAddressSnapshot: snapshotAddress(address),
          deliveryAddressSnapshot: snapshotAddress(order.shippingAddress),
          codAmount: 0,
          status: 'READY_FOR_PICKUP',
        },
      ],
      { session },
    );
    order.orderStatus = 'PROCESSING';
    order.sellerAcceptedAt ||= new Date();
    await order.save({ session });
    await notify(session, {
      recipientId: order.buyerId,
      actorId: seller._id,
      type: 'SHIPMENT_CREATED',
      title: 'Người bán đã đặt vận chuyển',
      body: `${data.carrierName} · Mã vận đơn ${data.trackingNumber}. Đang chờ bàn giao hàng.`,
      resourceType: 'SHIPMENT',
      resourceId: shipment._id,
      key: `shipment:${shipment._id}:created`,
    });
    return shipment;
  });
const handover = (seller, id, { note }) =>
  transaction(async (session) => {
    const shipment = await Shipment.findOne({
      _id: id,
      sellerId: seller._id,
      provider: 'manual',
    }).session(session);
    if (!shipment) throw new ApiError(404, 'Không tìm thấy vận đơn của cửa hàng.');
    const order = await Order.findOneAndUpdate(
      {
        _id: shipment.orderId,
        sellerId: seller._id,
        paymentStatus: 'PAID',
        orderStatus: { $in: ['PROCESSING', 'SHIPPED'] },
      },
      { $inc: { settlementVersion: 1 } },
      { new: true, session },
    );
    if (!order) throw new ApiError(409, 'Đơn không đủ điều kiện gửi hàng.');
    if (shipment.handoverConfirmedAt) return shipment;
    if (!['PENDING', 'READY_FOR_PICKUP'].includes(shipment.status))
      throw new ApiError(409, 'Vận đơn không còn chờ bàn giao.');
    shipment.status = 'PICKED_UP';
    shipment.pickedUpAt = new Date();
    shipment.handoverConfirmedAt = new Date();
    shipment.handoverNote = note;
    await shipment.save({ session });
    order.orderStatus = 'SHIPPED';
    await order.save({ session });
    await notify(session, {
      recipientId: shipment.buyerId,
      actorId: seller._id,
      type: 'SHIPMENT_PICKED_UP',
      title: 'Người bán đã bàn giao hàng',
      body: `${shipment.carrierName} · ${shipment.trackingNumber}. Hãy xác nhận nhận hàng khi bạn đã nhận và kiểm tra.`,
      resourceType: 'ORDER',
      resourceId: order._id,
      key: `shipment:${id}:handed-over`,
    });
    return shipment;
  });
const lockPayoutOrders = async (payout, session) => {
  const orders = [];
  for (const id of [...payout.orderIds].sort((a, b) => String(a).localeCompare(String(b)))) {
    const order = await Order.findOneAndUpdate(
      { _id: id, sellerId: payout.sellerId, orderStatus: 'COMPLETED', paymentStatus: 'PAID' },
      { $inc: { settlementVersion: 1 } },
      { new: true, session },
    );
    if (
      !order ||
      !order.completedBy ||
      !order.deliveredAt ||
      !order.protectionEndsAt ||
      order.protectionEndsAt > new Date()
    )
      throw new ApiError(409, 'Đơn chưa được admin duyệt hoặc còn thời hạn bảo vệ.');
    if (
      !order.completedAt ||
      new Date(order.completedAt.getTime() + require('../config/env').PAYOUT_HOLD_DAYS * 86400000) >
        new Date()
    )
      throw new ApiError(409, 'Đơn vẫn trong thời gian giữ tiền sau hoàn tất.');
    await assertNoFinancialHold(order, session);
    orders.push(order);
  }
  const profile = await SellerProfile.findOne({
    userId: payout.sellerId,
    status: 'ACTIVE',
  }).session(session);
  const seller = await require('../models/user.model')
    .exists({ _id: payout.sellerId, status: 'ACTIVE' })
    .session(session);
  if (!profile || !seller)
    throw new ApiError(409, 'Shop cần xác minh và đang hoạt động để nhận tiền.');
  if (payout.provider === 'manual') {
    if (payout.status === 'APPROVED' && payout.verificationId)
      await require('./sellerVerificationPolicy.service').assertSnapshot(
        payout.sellerId,
        payout.verificationId,
        payout.bankSnapshot,
        session,
      );
    else {
      const policy = require('./sellerVerificationPolicy.service');
      const verification = await policy.assertVerified(payout.sellerId, session);
      if (payout.status === 'APPROVED') {
        if (
          !payout.bankSnapshot?.accountNumber ||
          verification.bankFingerprint !== policy.bankFingerprint(payout.bankSnapshot)
        )
          throw new ApiError(
            409,
            'Khoản chi cũ có tài khoản khác hồ sơ đã xác minh. Cần đối soát trước khi ghi nhận chuyển tiền.',
          );
        payout.verificationId = verification._id;
      }
    }
  } else if (profile.verificationStatus !== 'VERIFIED')
    throw new ApiError(409, 'Shop chưa được xác minh.');
  const commissions = await Commission.find({
    orderId: { $in: payout.orderIds },
    status: { $ne: 'REVERSED' },
  }).session(session);
  if (
    commissions.length !== orders.length ||
    commissions.reduce((sum, item) => sum + item.sellerProceeds, 0) !== payout.amount
  )
    throw new ApiError(409, 'Số tiền chi trả không khớp hoa hồng đã chốt.');
  return orders;
};
const approveManualPayout = (admin, id) =>
  transaction(async (session) => {
    const payout = await Payout.findById(id).session(session);
    if (
      !payout ||
      !['PENDING', 'ELIGIBLE', 'APPROVED'].includes(payout.status) ||
      payout.provider !== 'manual'
    )
      throw new ApiError(
        409,
        'Đợt chi trả không còn chờ duyệt hoặc không phải chuyển khoản thủ công.',
      );
    if (String(payout.sellerId) === String(admin._id))
      throw new ApiError(403, 'Cần admin khác duyệt chi trả cho bạn.');
    await lockPayoutOrders(payout, session);
    await require('../models/user.model').updateOne(
      { _id: payout.sellerId },
      { $inc: { __v: 1 } },
      { session },
    );
    const bank = await BankAccount.findOne({ sellerId: payout.sellerId }).session(session);
    if (!bank) throw new ApiError(409, 'Người bán chưa khai báo tài khoản nhận tiền.');
    if (payout.status === 'APPROVED') {
      if (payout.isModified('verificationId')) {
        await payout.save({ session });
        await audit.record({
          admin,
          session,
          action: 'PAYOUT_VERIFICATION_LINKED',
          resourceType: 'PAYOUT',
          resourceId: payout._id,
          after: { verificationId: payout.verificationId, status: payout.status },
        });
      }
      return payout;
    }
    const verification = await require('./sellerVerificationPolicy.service').assertVerified(
      payout.sellerId,
      session,
    );
    payout.status = 'APPROVED';
    payout.approvedAt = new Date();
    payout.approvedBy = admin._id;
    payout.verificationId = verification._id;
    payout.bankSnapshot = {
      bankName: bank.bankName,
      bankBin: bank.bankBin,
      accountNumber: bank.accountNumber,
      accountName: bank.accountName,
    };
    await payout.save({ session });
    await audit.record({
      admin,
      session,
      action: 'PAYOUT_APPROVED',
      resourceType: 'PAYOUT',
      resourceId: payout._id,
      after: { status: 'APPROVED', amount: payout.amount, bankSnapshot: payout.bankSnapshot },
    });
    return payout;
  });
const recordManualPayout = (admin, id, data) =>
  transaction(async (session) => {
    const payout = await Payout.findById(id).session(session);
    if (!payout || payout.provider !== 'manual')
      throw new ApiError(409, 'Chỉ ghi nhận chuyển khoản thủ công cho đợt chi trả thủ công.');
    if (payout.status === 'PAID') {
      if (payout.transferReference === data.reference && payout.amount === data.amount)
        return payout;
      throw new ApiError(409, 'Đợt chi trả đã hoàn tất với giao dịch khác.');
    }
    if (
      payout.status !== 'APPROVED' ||
      !payout.bankSnapshot?.accountNumber ||
      payout.amount !== data.amount
    )
      throw new ApiError(
        409,
        'Cần duyệt chi trả và nhập đúng số tiền trước khi ghi nhận chuyển khoản.',
      );
    if (String(payout.sellerId) === String(admin._id))
      throw new ApiError(403, 'Cần admin khác ghi nhận khoản chi này.');
    await lockPayoutOrders(payout, session);
    await require('./outgoingBankTransfer.service').reserveReference(
      {
        reference: data.reference,
        resourceType: 'PAYOUT',
        resourceId: payout._id,
        amount: payout.amount,
      },
      session,
    );
    payout.status = 'PAID';
    payout.transferReference = data.reference;
    payout.transferNote = data.note;
    payout.recordedBy = admin._id;
    payout.processedAt = new Date();
    payout.completedAt = new Date();
    await payout.save({ session });
    const commissions = await Commission.find({ orderId: { $in: payout.orderIds } }).session(
      session,
    );
    for (const commission of commissions) {
      if (commission.status === 'PENDING') {
        commission.status = 'RECOGNIZED';
        commission.recognizedAt = new Date();
        await commission.save({ session });
        await ledger.postEntry(
          {
            sourceType: 'COMMISSION',
            sourceId: String(commission._id),
            sourceEventKey: `commission:${commission._id}:recognized`,
            description: 'Commission recognized after settlement',
            lines: [
              {
                account: 'platform_commission_revenue_pending',
                debit: commission.commissionAmount,
                credit: 0,
                currency: 'VND',
              },
              {
                account: 'platform_commission_revenue',
                debit: 0,
                credit: commission.commissionAmount,
                currency: 'VND',
              },
            ],
          },
          session,
        );
      }
    }
    await ledger.postEntry(
      {
        sourceType: 'PAYOUT',
        sourceId: payout.id,
        sourceEventKey: `payout:${id}:paid`,
        description: 'Bank transfer recorded by admin',
        lines: [
          {
            account: 'seller_liability',
            partyId: payout.sellerId,
            debit: payout.amount,
            credit: 0,
            currency: 'VND',
          },
          { account: 'provider_clearing', debit: 0, credit: payout.amount, currency: 'VND' },
        ],
      },
      session,
    );
    await audit.record({
      admin,
      session,
      action: 'PAYOUT_TRANSFER_RECORDED',
      resourceType: 'PAYOUT',
      resourceId: payout._id,
      reason: data.note,
      after: {
        amount: payout.amount,
        reference: data.reference,
        status: 'PAID',
        verificationId: payout.verificationId,
      },
    });
    await notify(session, {
      recipientId: payout.sellerId,
      actorId: admin._id,
      type: 'PAYOUT_COMPLETED',
      title: 'Sifit đã ghi nhận chuyển tiền cho cửa hàng',
      body: `Khoản chi ${payout.amount.toLocaleString('vi-VN')}đ đã được admin đối chiếu, mã giao dịch ${data.reference}.`,
      resourceType: 'PAYOUT',
      resourceId: payout._id,
      key: `payout:${id}:paid`,
    });
    return payout;
  });
module.exports = {
  getBank,
  saveBank,
  acceptOrder,
  completeOrder,
  manualShipment,
  handover,
  assertNoFinancialHold,
  notify,
  approveManualPayout,
  recordManualPayout,
  lockPayoutOrders,
};
