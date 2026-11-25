const templates = {
  'Product approved': {
    type: 'PRODUCT_APPROVED',
    title: 'Sản phẩm đã được duyệt',
    originalBody: 'Your product has been approved',
    body: 'Sản phẩm của bạn đã được duyệt.',
  },
  'Product rejected': {
    type: 'PRODUCT_REJECTED',
    title: 'Sản phẩm bị từ chối',
    originalBody: 'Your product was rejected during moderation',
    body: 'Sản phẩm của bạn bị từ chối sau khi kiểm duyệt.',
  },
  'Product submitted': {
    type: 'PRODUCT_SUBMITTED',
    title: 'Có sản phẩm chờ duyệt',
    originalBody: ' submitted a product for approval',
    body: ' đã gửi sản phẩm để chờ duyệt.',
  },
  'New order received': {
    type: 'ORDER_CREATED',
    title: 'Có đơn hàng mới',
    originalBody: 'You received a new order',
    body: 'Bạn vừa nhận được một đơn hàng mới.',
  },
  'Order cancelled': {
    type: 'ORDER_CANCELLED',
    title: 'Đơn hàng đã bị hủy',
    originalBody: 'An order was cancelled',
    body: 'Một đơn hàng đã bị hủy.',
  },
  'Buyer confirmed receipt': {
    type: 'DELIVERY_CONFIRMED',
    title: 'Người mua đã xác nhận nhận hàng',
    originalBody: 'The buyer confirmed receipt for an order',
    body: 'Người mua đã xác nhận nhận được hàng của đơn này.',
  },
  'Payment confirmed': {
    type: 'PAYMENT_CONFIRMED',
    title: 'Đã xác nhận thanh toán',
    originalBody: 'Your payment has been verified',
    body: 'Khoản thanh toán của bạn đã được xác nhận.',
  },
  'Order payment verified': {
    type: 'PAYMENT_CONFIRMED',
    title: 'Đơn hàng đã được thanh toán',
    originalBody: 'A buyer payment for your order has been verified',
    body: 'Khoản thanh toán của người mua cho đơn hàng của bạn đã được xác nhận.',
  },
  'Payout eligible': {
    type: 'PAYOUT_ELIGIBLE',
    title: 'Đủ điều kiện chi trả',
    originalBody: 'Seller proceeds are eligible for payout',
    body: 'Khoản tiền bán hàng đã đủ điều kiện chi trả.',
  },
  'Payout completed': {
    type: 'PAYOUT_COMPLETED',
    title: 'Đã hoàn tất chi trả',
    originalBody: 'A simulated seller payout has been completed',
    body: 'Một khoản chi trả mô phỏng cho người bán đã hoàn tất.',
  },
  'Shipment created': {
    type: 'SHIPMENT_CREATED',
    title: 'Đã tạo vận đơn',
    originalBody: 'Your order shipment has been created',
    body: 'Vận đơn cho đơn hàng của bạn đã được tạo.',
  },
  'Shipment picked up': {
    type: 'SHIPMENT_PICKED_UP',
    title: 'Đơn vị vận chuyển đã nhận hàng',
    originalBody: 'Your shipment has been picked up',
    body: 'Đơn vị vận chuyển đã nhận kiện hàng của bạn.',
  },
  'Shipment delivered': {
    type: 'SHIPMENT_DELIVERED',
    title: 'Kiện hàng đã được giao',
    originalBody: 'Your shipment has been delivered',
    body: 'Kiện hàng của bạn đã được giao.',
  },
  'New message': {
    type: 'NEW_MESSAGE',
    title: 'Tin nhắn mới',
    originalBody: ' sent you a message',
    body: ' đã gửi tin nhắn cho bạn.',
  },
  'New product review': {
    type: 'NEW_PRODUCT_REVIEW',
    title: 'Có đánh giá sản phẩm mới',
    originalBody: ' reviewed your product',
    body: ' đã đánh giá sản phẩm của bạn.',
  },
  'New seller rating': {
    type: 'NEW_SELLER_RATING',
    title: 'Có đánh giá cửa hàng mới',
    originalBody: ' rated your shop',
    body: ' đã đánh giá cửa hàng của bạn.',
  },
  'Dispute opened': {
    type: 'DISPUTE_OPENED',
    title: 'Có khiếu nại mới',
    originalBody: 'A buyer opened a dispute for an order',
    body: 'Người mua đã mở khiếu nại cho một đơn hàng.',
  },
  'Dispute resolved': {
    type: 'DISPUTE_RESOLVED',
    title: 'Khiếu nại đã được xử lý',
    originalBody: 'A dispute has been resolved',
    body: 'Một khiếu nại đã được xử lý.',
  },
};

const localizeNotificationText = (notification) => {
  const template = Object.hasOwn(templates, notification.title) && templates[notification.title];
  if (!template || template.type !== notification.type) return notification;

  const { title, originalBody, body: translatedBody } = template;
  let { body } = notification;
  if (body === originalBody) {
    body = translatedBody;
  } else if (originalBody.startsWith(' ') && body?.endsWith(originalBody)) {
    body = body.slice(0, -originalBody.length) + translatedBody;
  }
  return { ...notification, title, body };
};

module.exports = localizeNotificationText;
