const mongoose = require('mongoose');
const httpStatus = require('../constants/httpStatus');
const paymentAttemptStatus = require('../constants/paymentAttemptStatus');
const Payment = require('../models/payment.model');
const Refund = require('../models/refund.model');
const ApiError = require('../utils/ApiError');
const { getPaymentProvider } = require('./paymentProviders/paymentProvider.factory');
const ledgerService = require('./ledger.service');

const requestRefund = async ({ paymentId, amount, idempotencyKey, reason }) => {
  const payment = await Payment.findById(paymentId);

  if (!payment || payment.status !== paymentAttemptStatus.SUCCEEDED) {
    throw new ApiError(httpStatus.CONFLICT, 'Only successful payments can be refunded');
  }

  const refundedAmount = payment.refundedAmount || 0;

  if (amount > payment.amount - refundedAmount) {
    throw new ApiError(httpStatus.CONFLICT, 'Refund amount exceeds refundable amount');
  }

  const existing = await Refund.findOne({ paymentId, idempotencyKey });
  if (existing) return existing;

  const session = await mongoose.startSession();

  try {
    let refund;

    await session.withTransaction(async () => {
      const provider = getPaymentProvider(payment.provider);
      const providerRefund = await provider.refundPayment({ payment, amount });
      const refunds = await Refund.create(
        [
          {
            paymentId: payment._id,
            checkoutGroupId: payment.checkoutGroupId,
            amount,
            currency: payment.currency,
            status: providerRefund.status,
            provider: payment.provider,
            providerRefundId: providerRefund.providerRefundId,
            idempotencyKey,
            reason,
          },
        ],
        { session },
      );

      refund = refunds[0];
      payment.status =
        amount + refundedAmount >= payment.amount
          ? paymentAttemptStatus.REFUND_PENDING
          : paymentAttemptStatus.PARTIALLY_REFUNDED;
      payment.refundedAmount = refundedAmount + amount;
      await payment.save({ session });
      await ledgerService.postRefund(
        { refund, payment, eventKey: `refund:${refund._id}:requested` },
        session,
      );
    });

    return refund;
  } finally {
    await session.endSession();
  }
};

const reconcilePendingRefunds = async () => ({ reconciledCount: 0 });

module.exports = {
  reconcilePendingRefunds,
  requestRefund,
};
