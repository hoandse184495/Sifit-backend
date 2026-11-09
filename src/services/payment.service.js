const crypto = require('crypto');
const mongoose = require('mongoose');
const env = require('../config/env');
const roles = require('../constants/roles');
const CheckoutGroup = require('../models/checkoutGroup.model');
const Payment = require('../models/payment.model');
const ApiError = require('../utils/ApiError');
const { createRequestFingerprint } = require('../utils/idempotency');
const { getPaymentProvider } = require('./paymentProviders/paymentProvider.factory');
const activePaymentStatuses = ['INITIATED', 'PENDING'];
const safePayment = (payment) => ({
  id: payment.id,
  checkoutGroupId: payment.checkoutGroupId,
  provider: payment.provider,
  providerPaymentId: payment.providerPaymentId,
  merchantReference: payment.merchantReference,
  amount: payment.amount,
  currency: payment.currency,
  status: payment.status,
  paymentUrl: payment.paymentUrl,
  qrCode: payment.qrCode,
  bankInfo: payment.bankInfo,
  expiresAt: payment.expiresAt,
  paidAt: payment.paidAt,
  failedAt: payment.failedAt,
  refundedAmount: payment.refundedAmount,
  createdAt: payment.createdAt,
  requiresReview: Boolean(payment.metadata?.exception),
  reviewReason: payment.metadata?.exception,
  exceptionReviewState: payment.exceptionReviewState,
  exceptionRefundedAmount: payment.exceptionRefundedAmount,
});
const initializeProvider = async (payment) => {
  if (payment.status !== 'INITIATED') return payment;
  const leased = await Payment.findOneAndUpdate(
    {
      _id: payment._id,
      status: 'INITIATED',
      $or: [{ creationLeaseUntil: null }, { creationLeaseUntil: { $lte: new Date() } }],
    },
    { $set: { creationLeaseUntil: new Date(Date.now() + 45000) } },
    { new: true },
  );
  if (!leased) return Payment.findById(payment._id);
  try {
    const data = await getPaymentProvider(leased.provider).createPayment({
      merchantReference: leased.merchantReference,
      amount: leased.amount,
      currency: leased.currency,
      expiresAt: leased.expiresAt,
      paymentId: leased.id,
    });
    await Payment.updateOne(
      { _id: leased._id, status: 'INITIATED' },
      {
        $set: {
          providerPaymentId: data.providerPaymentId,
          paymentUrl: data.paymentUrl,
          ...(data.qrCode ? { qrCode: data.qrCode } : {}),
          ...(data.bankInfo ? { bankInfo: data.bankInfo } : {}),
          status: 'PENDING',
        },
        $unset: { creationLeaseUntil: 1 },
      },
    );
  } catch (error) {
    await Payment.updateOne({ _id: leased._id }, { $unset: { creationLeaseUntil: 1 } });
    throw error;
  }
  return Payment.findById(payment._id);
};
const createPayment = async ({ buyer, checkoutGroupId, idempotencyKey }) => {
  if (env.PAYMENT_PROVIDER === 'payos') require('../config/payos').getClient();
  const fingerprint = createRequestFingerprint({ checkoutGroupId });
  const session = await mongoose.startSession();
  let payment;
  try {
    const byKey = await Payment.findOne({ buyerId: buyer._id, idempotencyKey });
    if (byKey && byKey.requestFingerprint !== fingerprint)
      throw new ApiError(409, 'Idempotency key was already used with a different request');
    await session.withTransaction(async () => {
      const group = await CheckoutGroup.findOneAndUpdate(
        { _id: checkoutGroupId, buyerId: buyer._id },
        { $inc: { paymentVersion: 1 } },
        { new: true, session },
      );
      if (!group) {
        const exists = await CheckoutGroup.exists({ _id: checkoutGroupId }).session(session);
        throw new ApiError(
          exists ? 403 : 404,
          exists ? 'You do not have permission to pay this checkout' : 'Checkout group not found',
        );
      }
      const existing = await Payment.findOne({ buyerId: buyer._id, idempotencyKey }).session(
        session,
      );
      if (existing) {
        if (existing.requestFingerprint !== fingerprint)
          throw new ApiError(409, 'Idempotency key was already used with a different request');
        payment = existing;
        return;
      }
      if (group.orderStatus !== 'PENDING_PAYMENT' || group.paymentStatus !== 'UNPAID')
        throw new ApiError(409, 'Checkout is not eligible for payment');
      if (group.reservationExpiresAt <= new Date())
        throw new ApiError(409, 'Checkout reservation has expired');
      payment = await Payment.findOne({
        checkoutGroupId,
        status: { $in: activePaymentStatuses },
        expiresAt: { $gt: new Date() },
      }).session(session);
      if (payment) return;
      const merchantReference =
        env.PAYMENT_PROVIDER === 'payos'
          ? String(crypto.randomInt(1, 2 ** 47))
          : 'sifit_' + group._id + '_' + crypto.randomUUID();
      [payment] = await Payment.create(
        [
          {
            checkoutGroupId,
            buyerId: buyer._id,
            provider: env.PAYMENT_PROVIDER,
            merchantReference,
            providerPaymentId: 'initializing_' + merchantReference,
            amount: group.buyerTotal,
            currency: 'VND',
            status: 'INITIATED',
            idempotencyKey,
            requestFingerprint: fingerprint,
            expiresAt: group.reservationExpiresAt,
          },
        ],
        { session },
      );
    });
  } catch (error) {
    if (error.code === 11000) {
      payment = await Payment.findOne({ buyerId: buyer._id, idempotencyKey });
      if (!payment || payment.requestFingerprint !== fingerprint)
        throw new ApiError(409, 'Payment request conflict; please retry');
    } else throw error;
  } finally {
    await session.endSession();
  }
  if (payment.status === 'INITIATED') {
    const group = await CheckoutGroup.findById(payment.checkoutGroupId);
    if (group?.orderStatus !== 'PENDING_PAYMENT' || group.reservationExpiresAt <= new Date())
      throw new ApiError(409, 'Checkout reservation has expired or is no longer payable');
    payment = await initializeProvider(payment);
  }
  return safePayment(payment);
};
const reconcilePayment = async (payment) => {
  if (payment.provider !== 'payos' || !['INITIATED', 'PENDING', 'EXPIRED'].includes(payment.status))
    return payment;
  const claimed = await Payment.findOneAndUpdate(
    {
      _id: payment._id,
      $or: [{ lastQueriedAt: null }, { lastQueriedAt: { $lte: new Date(Date.now() - 4000) } }],
    },
    { $set: { lastQueriedAt: new Date() } },
    { new: true },
  );
  if (!claimed) return Payment.findById(payment._id);
  const result = await getPaymentProvider('payos').queryPayment(claimed);
  if (result.status === 'SUCCEEDED')
    await require('./paymentWebhook.service').handleVerifiedEvent({
      providerName: 'payos',
      parsedEvent: result,
      payload: { source: 'provider-query', result },
    });
  else if (['CANCELLED', 'EXPIRED', 'FAILED'].includes(result.status))
    await Payment.updateOne(
      { _id: payment._id, status: { $in: activePaymentStatuses } },
      {
        $set: { status: result.status === 'EXPIRED' ? 'EXPIRED' : 'FAILED', failedAt: new Date() },
      },
    );
  return Payment.findById(payment._id);
};
const getPayment = async (id, user) => {
  let payment = await Payment.findById(id);
  if (!payment) throw new ApiError(404, 'Payment not found');
  if (!payment.buyerId.equals(user._id) && user.role !== roles.ADMIN)
    throw new ApiError(403, 'You do not have permission to access this payment');
  try {
    payment = await reconcilePayment(payment);
  } catch (_error) {
    return {
      ...safePayment(await Payment.findById(id)),
      reconciliationNotice:
        'Chưa kết nối được PayOS để kiểm tra. Bạn có thể thử lại; trạng thái thanh toán được giữ nguyên.',
    };
  }
  return safePayment(payment);
};
const expirePendingPayments = async ({ now = new Date(), limit = 50 } = {}) => {
  const payosPayments = await Payment.find({
    provider: 'payos',
    status: { $in: [...activePaymentStatuses, 'EXPIRED'] },
    createdAt: { $gte: new Date(now - 7 * 86400000) },
  })
    .sort({ lastQueriedAt: 1 })
    .limit(limit);
  let reconciledCount = 0;
  let failedCount = 0;
  for (const payment of payosPayments) {
    try {
      await reconcilePayment(payment);
      reconciledCount += 1;
    } catch (_error) {
      failedCount += 1;
      /* Retry on the next reconciliation run. */
    }
  }
  const result = await Payment.updateMany(
    // PayOS expiry must come from its verified query, not a local timer/network failure.
    { provider: 'simulator', status: { $in: activePaymentStatuses }, expiresAt: { $lte: now } },
    { status: 'EXPIRED', failedAt: now },
  );
  return { expiredCount: result.modifiedCount, reconciledCount, failedCount };
};
module.exports = {
  createPayment,
  expirePendingPayments,
  getPayment,
  safePayment,
  reconcilePayment,
};
