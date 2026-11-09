const Refund = require('../models/refund.model');
const Payment = require('../models/payment.model');

const activeRefundStatuses = ['REQUESTED', 'PENDING', 'APPROVED'];
// New manual refunds have per-order allocation. Legacy refunds and receipt exceptions
// remain group-wide holds until an operator can reconcile them explicitly.
const hasRefundHold = async (order, session = null) => {
  if (
    order.refundPendingAmount > 0 ||
    (await Refund.exists({
      orderId: order._id,
      kind: 'MANUAL_BANK',
      status: { $in: activeRefundStatuses },
    }).session(session))
  )
    return true;
  if (
    await Payment.exists({
      checkoutGroupId: order.checkoutGroupId,
      $or: [
        { 'metadata.exception': { $exists: true } },
        { exceptionReviewState: { $in: ['OPEN', 'WAITING_TOPUP', 'REFUND_PENDING'] } },
      ],
    }).session(session)
  )
    return true;
  const payments = await Payment.find({
    checkoutGroupId: order.checkoutGroupId,
    $or: [
      { refundedAmount: { $gt: 0 } },
      { status: { $in: ['REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED'] } },
    ],
  }).session(session);
  for (const payment of payments) {
    if (
      payment.status === 'REFUNDED' &&
      !payment.refundedAmount &&
      payment.exceptionRefundedAmount > 0 &&
      payment.exceptionReviewState === 'RESOLVED'
    )
      continue;
    const allocated = await Refund.find({
      paymentId: payment._id,
      kind: 'MANUAL_BANK',
      status: 'SUCCEEDED',
    }).session(session);
    const total = allocated.reduce((sum, refund) => sum + refund.amount, 0);
    if (total !== (payment.refundedAmount || 0) || (payment.status !== 'SUCCEEDED' && total === 0))
      return true;
  }
  return false;
};
module.exports = { activeRefundStatuses, hasRefundHold };
