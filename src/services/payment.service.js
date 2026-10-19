const crypto = require('crypto');
const env = require('../config/env');
const httpStatus = require('../constants/httpStatus');
const orderStatus = require('../constants/orderStatus');
const paymentStatus = require('../constants/paymentStatus');
const paymentAttemptStatus = require('../constants/paymentAttemptStatus');
const roles = require('../constants/roles');
const CheckoutGroup = require('../models/checkoutGroup.model');
const Payment = require('../models/payment.model');
const ApiError = require('../utils/ApiError');
const { createRequestFingerprint } = require('../utils/idempotency');
const { getPaymentProvider } = require('./paymentProviders/paymentProvider.factory');

const activePaymentStatuses = [paymentAttemptStatus.INITIATED, paymentAttemptStatus.PENDING];

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
  expiresAt: payment.expiresAt,
  paidAt: payment.paidAt,
  failedAt: payment.failedAt,
  refundedAmount: payment.refundedAmount,
  createdAt: payment.createdAt,
});

const createPayment = async ({ buyer, checkoutGroupId, idempotencyKey }) => {
  const requestFingerprint = createRequestFingerprint({ checkoutGroupId });
  const existingByKey = await Payment.findOne({ buyerId: buyer._id, idempotencyKey });

  if (existingByKey) {
    if (existingByKey.requestFingerprint !== requestFingerprint) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'Idempotency key was already used with a different request',
      );
    }

    return safePayment(existingByKey);
  }

  const checkoutGroup = await CheckoutGroup.findById(checkoutGroupId);

  if (!checkoutGroup) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Checkout group not found');
  }

  if (!checkoutGroup.buyerId.equals(buyer._id)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'You do not have permission to pay this checkout');
  }

  if (
    checkoutGroup.orderStatus !== orderStatus.PENDING_PAYMENT ||
    checkoutGroup.paymentStatus !== paymentStatus.UNPAID
  ) {
    throw new ApiError(httpStatus.CONFLICT, 'Checkout is not eligible for payment');
  }

  if (checkoutGroup.reservationExpiresAt <= new Date()) {
    throw new ApiError(httpStatus.CONFLICT, 'Checkout reservation has expired');
  }

  const activePayment = await Payment.findOne({
    checkoutGroupId: checkoutGroup._id,
    status: { $in: activePaymentStatuses },
    expiresAt: { $gt: new Date() },
  });

  if (activePayment) {
    return safePayment(activePayment);
  }

  const provider = getPaymentProvider(env.PAYMENT_PROVIDER);
  const merchantReference = `sifit_${checkoutGroup._id}_${crypto.randomUUID()}`;
  const expiresAt = checkoutGroup.reservationExpiresAt;
  const payment = await Payment.create({
    checkoutGroupId: checkoutGroup._id,
    buyerId: buyer._id,
    provider: provider.name,
    merchantReference,
    amount: checkoutGroup.buyerTotal,
    currency: 'VND',
    status: paymentAttemptStatus.INITIATED,
    idempotencyKey,
    requestFingerprint,
    expiresAt,
  });

  const providerPayment = await provider.createPayment({
    merchantReference,
    amount: payment.amount,
    currency: payment.currency,
    expiresAt,
  });

  payment.providerPaymentId = providerPayment.providerPaymentId;
  payment.paymentUrl = providerPayment.paymentUrl;
  payment.status = paymentAttemptStatus.PENDING;
  await payment.save();

  return safePayment(payment);
};

const getPayment = async (id, user) => {
  const payment = await Payment.findById(id);

  if (!payment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Payment not found');
  }

  if (!payment.buyerId.equals(user._id) && user.role !== roles.ADMIN) {
    throw new ApiError(httpStatus.FORBIDDEN, 'You do not have permission to access this payment');
  }

  return safePayment(payment);
};

const expirePendingPayments = async ({ now = new Date(), limit = 50 } = {}) => {
  const result = await Payment.updateMany(
    { status: { $in: activePaymentStatuses }, expiresAt: { $lte: now } },
    { status: paymentAttemptStatus.EXPIRED, failedAt: now },
    { limit },
  );

  return { expiredCount: result.modifiedCount };
};

module.exports = {
  createPayment,
  expirePendingPayments,
  getPayment,
  safePayment,
};
