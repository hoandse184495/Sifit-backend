const Dispute = require('../models/dispute.model');
const ApiError = require('../utils/ApiError');
const assertReturnSatisfied = async (orderId, session = null) => {
  const blocked = await Dispute.exists({
    orderId,
    'returnFlow.required': true,
    $or: [
      { 'returnFlow.status': { $ne: 'VERIFIED' } },
      { 'returnFlow.verification.adminId': null },
    ],
  }).session(session);
  if (blocked)
    throw new ApiError(
      409,
      'Đơn cần trả hàng và được admin xác minh nhận lại trước khi hoàn tiền.',
    );
};
module.exports = { assertReturnSatisfied };
