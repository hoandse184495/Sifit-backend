const env = require('../config/env');

const toBasisPoints = (percent) => Math.round(Number(percent) * 100);

const calculateCommission = (subtotal, commissionRate = env.COMMISSION_RATE) => {
  const commissionRateBasisPoints = toBasisPoints(commissionRate);
  const commissionAmount = Math.round((subtotal * commissionRateBasisPoints) / 10000);

  return {
    commissionRateBasisPoints,
    commissionAmount,
    sellerProceeds: subtotal - commissionAmount,
  };
};

module.exports = {
  calculateCommission,
  toBasisPoints,
};
