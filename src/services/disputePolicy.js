const orderStatus = require('../constants/orderStatus');
const paymentStatus = require('../constants/paymentStatus');

const receivedItemReasons = [
  'ITEM_NOT_RECEIVED',
  'ITEM_NOT_AS_DESCRIBED',
  'DAMAGED_ITEM',
  'WRONG_ITEM',
  'OTHER',
];

// A paid order remains protected against non-delivery until delivery is verified.
// Opening a case requests admin review; it does not confirm a refund.
const getDisputeEligibility = (order, now = new Date()) => {
  if (order.paymentStatus !== paymentStatus.PAID) {
    return { eligible: false, allowedReasons: [], window: null };
  }
  if (
    !order.deliveredAt &&
    [orderStatus.PAID, orderStatus.PROCESSING, orderStatus.SHIPPED].includes(order.orderStatus)
  ) {
    return { eligible: true, allowedReasons: ['ITEM_NOT_RECEIVED'], window: 'BEFORE_DELIVERY' };
  }
  if (
    [orderStatus.DELIVERED, orderStatus.COMPLETED].includes(order.orderStatus) &&
    order.protectionEndsAt &&
    new Date(order.protectionEndsAt) >= now
  ) {
    return { eligible: true, allowedReasons: receivedItemReasons, window: 'AFTER_DELIVERY' };
  }
  return { eligible: false, allowedReasons: [], window: null };
};

module.exports = { getDisputeEligibility };
