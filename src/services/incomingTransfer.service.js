const Reference = require('../models/incomingTransferReference.model');
const ApiError = require('../utils/ApiError');
const reserve = async ({ reference, sourceType, sourceId, amount }, session) => {
  const key = reference.trim().toUpperCase();
  const item = await Reference.findOneAndUpdate({ _id: key }, { $setOnInsert: { sourceType, sourceId: String(sourceId), amount } }, { new: true, upsert: true, session });
  if (item.sourceType !== sourceType || item.sourceId !== String(sourceId) || item.amount !== amount)
    throw new ApiError(409, 'Bank receipt was already allocated to another payment or recovery');
};
module.exports = { reserve };
