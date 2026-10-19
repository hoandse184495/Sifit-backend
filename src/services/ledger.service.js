const httpStatus = require('../constants/httpStatus');
const LedgerEntry = require('../models/ledgerEntry.model');
const ApiError = require('../utils/ApiError');

const assertBalanced = (lines) => {
  const debit = lines.reduce((sum, line) => sum + line.debit, 0);
  const credit = lines.reduce((sum, line) => sum + line.credit, 0);

  if (debit !== credit) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Ledger entry must balance');
  }
};

const postEntry = async ({ sourceType, sourceId, sourceEventKey, description, lines }, session) => {
  assertBalanced(lines);

  try {
    const entries = await LedgerEntry.create(
      [
        {
          sourceType,
          sourceId,
          sourceEventKey,
          description,
          lines,
        },
      ],
      { session },
    );

    return entries[0];
  } catch (error) {
    if (error.code === 11000) {
      return LedgerEntry.findOne({ sourceEventKey }).session(session || null);
    }

    throw error;
  }
};

const postPaymentSuccess = async ({ payment, orders, eventId }, session) => {
  const lines = [
    { account: 'provider_clearing', debit: payment.amount, credit: 0, currency: 'VND' },
  ];

  orders.forEach((order) => {
    lines.push({
      account: 'seller_liability',
      debit: 0,
      credit: order.sellerProceeds,
      currency: 'VND',
      partyId: order.sellerId,
    });
    lines.push({
      account: 'platform_commission_revenue_pending',
      debit: 0,
      credit: order.commissionAmount,
      currency: 'VND',
    });
  });

  return postEntry(
    {
      sourceType: 'PAYMENT',
      sourceId: String(payment._id),
      sourceEventKey: `payment:${eventId}:success`,
      description: 'Verified simulator payment success',
      lines,
    },
    session,
  );
};

const postRefund = async ({ refund, payment, eventKey }, session) =>
  postEntry(
    {
      sourceType: 'REFUND',
      sourceId: String(refund._id),
      sourceEventKey: eventKey,
      description: 'Refund requested in simulator',
      lines: [
        { account: 'refunds_pending', debit: refund.amount, credit: 0, currency: payment.currency },
        {
          account: 'provider_clearing',
          debit: 0,
          credit: refund.amount,
          currency: payment.currency,
        },
      ],
    },
    session,
  );

module.exports = {
  postEntry,
  postPaymentSuccess,
  postRefund,
};
