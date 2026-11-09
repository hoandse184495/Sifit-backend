const Transfer = require('../models/outgoingBankTransfer.model');
const Refund = require('../models/refund.model');
const Payout = require('../models/sellerPayout.model');
const ApiError = require('../utils/ApiError');

const reserveReference = async ({ reference, resourceType, resourceId, amount }, session) => {
  const normalized = reference.trim().toUpperCase();
  const exact = new RegExp(`^${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  // Include historical transfers recorded before the shared registry existed.
  for (const [type, model] of [
    ['REFUND', Refund],
    ['PAYOUT', Payout],
  ]) {
    if (
      await model
        .exists({
          transferReference: exact,
          ...(type === resourceType ? { _id: { $ne: resourceId } } : {}),
        })
        .session(session)
    )
      throw new ApiError(409, 'Mã giao dịch đã được dùng cho một khoản hoàn hoặc chi trả khác.');
  }
  await Transfer.create([{ reference: normalized, resourceType, resourceId, amount }], { session });
};
module.exports = { reserveReference };
