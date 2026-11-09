const Receipt = require('../models/paymentTransaction.model');
const Ledger = require('../models/ledgerEntry.model');
const Refund = require('../models/refund.model');
const Action = require('../models/paymentReviewAction.model');
const ApiError = require('../utils/ApiError');
const totals = async (payment, session = null) => {
  const receipts = await Receipt.find({
    paymentId: payment._id,
    provider: 'payos',
    status: 'MATCHED',
  })
    .sort({ occurredAt: 1, _id: 1 })
    .session(session);
  const receivedAmount = receipts.reduce((sum, receipt) => sum + receipt.amount, 0);
  const allocated = await Ledger.exists({
    sourceEventKey: `payment:${payment._id}:allocated`,
  }).session(session);
  const allocatedAmount = allocated ? payment.amount : 0;
  const adjustmentRefundedAmount = payment.exceptionRefundedAmount || 0;
  const adjustmentReservedAmount = payment.exceptionRefundReservedAmount || 0;
  const unallocatedAmount = receivedAmount - allocatedAmount - adjustmentRefundedAmount;
  if (
    ![
      receivedAmount,
      allocatedAmount,
      adjustmentRefundedAmount,
      adjustmentReservedAmount,
      unallocatedAmount,
    ].every(Number.isSafeInteger) ||
    unallocatedAmount < 0 ||
    adjustmentReservedAmount > unallocatedAmount
  )
    throw new ApiError(409, 'Số dư biên nhận và phân bổ chưa khớp, cần kiểm tra sổ cái.');
  return {
    receipts,
    receivedAmount,
    allocatedAmount,
    adjustmentRefundedAmount,
    adjustmentReservedAmount,
    unallocatedAmount,
    availableAmount: unallocatedAmount - adjustmentReservedAmount,
    missingAmount: allocatedAmount ? 0 : Math.max(0, payment.amount - unallocatedAmount),
  };
};
const syncReviewState = async (payment, session) => {
  const balance = await totals(payment, session);
  payment.metadata = { ...payment.metadata };
  if (balance.adjustmentReservedAmount > 0) {
    payment.exceptionReviewState = 'REFUND_PENDING';
    payment.metadata.exception = 'receipt_refund_pending';
  } else if (balance.unallocatedAmount > 0) {
    payment.exceptionReviewState = 'OPEN';
    payment.metadata.exception = balance.allocatedAmount
      ? 'additional_payment_after_success'
      : balance.unallocatedAmount < payment.amount
        ? 'amount_or_currency_mismatch'
        : 'paid_after_checkout_ineligible';
  } else {
    payment.exceptionReviewState = 'RESOLVED';
    delete payment.metadata.exception;
    delete payment.metadata.receivedAmount;
    if (!balance.allocatedAmount && balance.receivedAmount > 0) payment.status = 'REFUNDED';
  }
  if (payment.metadata.exception) payment.metadata.receivedAmount = balance.receivedAmount;
  payment.markModified('metadata');
  payment.reviewVersion = (payment.reviewVersion || 0) + 1;
  await payment.save({ session });
  return balance;
};
const assertRefundFunds = async (refund, payment, session) => {
  if (payment.provider !== 'payos' || String(refund.buyerId) !== String(payment.buyerId))
    throw new ApiError(409, 'Khoản hoàn không khớp người nộp tiền.');
  const balance = await totals(payment, session);
  const pending = await Refund.find({
    paymentId: payment._id,
    kind: 'RECEIPT_ADJUSTMENT',
    status: { $in: ['REQUESTED', 'PENDING', 'APPROVED'] },
  }).session(session);
  if (
    pending.reduce((sum, item) => sum + item.amount, 0) !== balance.adjustmentReservedAmount ||
    balance.adjustmentReservedAmount < refund.amount
  )
    throw new ApiError(409, 'Số tiền giữ hoàn từ biên nhận chưa khớp.');
  return balance;
};
const recordRefundAction = async (refund, payment, admin, action, note, session) => {
  const balance = await totals(payment, session);
  await Action.create(
    [
      {
        paymentId: payment._id,
        adminId: admin._id,
        action,
        idempotencyKey: `refund:${refund._id}:${action}`,
        requestFingerprint: `refund:${refund._id}:${action}`,
        note,
        amount: refund.amount,
        refundId: refund._id,
        receivedAmount: balance.receivedAmount,
        allocatedAmount: balance.allocatedAmount,
        adjustmentRefundedAmount: balance.adjustmentRefundedAmount,
      },
    ],
    { session },
  );
};
module.exports = { totals, syncReviewState, assertRefundFunds, recordRefundAction };
