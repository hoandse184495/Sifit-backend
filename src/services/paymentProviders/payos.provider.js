const { z } = require('zod');
const { URL } = require('url');
const payos = require('../../config/payos');
const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const PaymentProviderInterface = require('./paymentProvider.interface');
const webhookData = z.object({
  orderCode: z.number().int().positive().safe(),
  amount: z.number().int().positive().safe(),
  currency: z.literal('VND'),
  paymentLinkId: z.string().min(1).max(100),
  reference: z.string().min(1).max(150),
  code: z.string(),
  transactionDateTime: z.string().optional(),
});
const dateOf = (value) => {
  const date = new Date(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value || '')
      ? `${value.replace(' ', 'T')}+07:00`
      : value || Date.now(),
  );
  if (Number.isNaN(date.getTime())) throw new ApiError(400, 'Invalid PayOS transaction date');
  return date;
};
class PayosProvider extends PaymentProviderInterface {
  constructor() {
    super();
    this.name = 'payos';
    this.capabilities = {
      createPayment: true,
      queryPayment: true,
      verifyWebhook: true,
      parseWebhook: true,
      refundPayment: false,
    };
  }
  async verifyWebhook({ payload }) {
    try {
      await payos.getClient().webhooks.verify(payload);
      return webhookData.safeParse(payload.data).success;
    } catch (error) {
      if (error.statusCode === 503) throw error;
      return false;
    }
  }
  parseWebhook(payload) {
    const data = webhookData.parse(payload.data);
    return {
      eventId: `payos:${data.paymentLinkId}:${data.reference}`,
      eventType: data.code === '00' ? 'payment.succeeded' : 'payment.ignored',
      providerPaymentId: data.paymentLinkId,
      merchantReference: String(data.orderCode),
      amount: data.amount,
      currency: data.currency,
      occurredAt: dateOf(data.transactionDateTime),
      status: data.code === '00' ? 'SUCCEEDED' : 'IGNORED',
    };
  }
  async createPayment({ merchantReference, amount, expiresAt, paymentId }) {
    const client = payos.getClient();
    const returnUrl = new URL('/', env.FRONTEND_URL);
    returnUrl.searchParams.set('view', 'payment-result');
    returnUrl.searchParams.set('paymentId', paymentId);
    const cancelUrl = new URL(returnUrl);
    cancelUrl.searchParams.set('cancelled', '1');
    try {
      const data = await client.paymentRequests.create({
        orderCode: Number(merchantReference),
        amount,
        description: `SF${merchantReference.slice(-7)}`,
        returnUrl: returnUrl.href,
        cancelUrl: cancelUrl.href,
        expiredAt: Math.floor(expiresAt.getTime() / 1000),
      });
      if (
        data.amount !== amount ||
        String(data.orderCode) !== merchantReference ||
        data.currency !== 'VND' ||
        !data.paymentLinkId ||
        !/^https:\/\/pay\.payos\.vn\//.test(data.checkoutUrl || '') ||
        !data.qrCode
      )
        throw new ApiError(502, 'PayOS trả về thông tin thanh toán không khớp.');
      return {
        providerPaymentId: data.paymentLinkId,
        paymentUrl: data.checkoutUrl,
        qrCode: data.qrCode,
        bankInfo: {
          bin: data.bin,
          accountNumber: data.accountNumber,
          accountName: data.accountName,
          description: data.description,
        },
        status: 'PENDING',
      };
    } catch (error) {
      if (error.statusCode) throw error;
      // An earlier timed-out request may already have created this exact orderCode.
      try {
        const link = await client.paymentRequests.get(Number(merchantReference));
        if (link.amount === amount && String(link.orderCode) === merchantReference && link.id)
          return {
            providerPaymentId: link.id,
            paymentUrl: `https://pay.payos.vn/web/${encodeURIComponent(link.id)}`,
            status: 'PENDING',
          };
      } catch (_error) {
        /* Leave the attempt retryable; never create another orderCode on an uncertain response. */
      }
      throw new ApiError(
        502,
        'Chưa tạo được QR PayOS. Hãy thử lại cùng đơn hàng hoặc kiểm tra kết nối PayOS.',
      );
    }
  }
  async queryPayment(payment) {
    const data = await payos.getClient().paymentRequests.get(Number(payment.merchantReference));
    if (
      String(data.orderCode) !== payment.merchantReference ||
      data.amount !== payment.amount ||
      !data.id ||
      (!payment.providerPaymentId.startsWith('initializing_') &&
        data.id !== payment.providerPaymentId)
    )
      throw new ApiError(409, 'Thông tin đối soát PayOS không khớp.');
    if (data.transactions?.length) {
      const receipts = data.transactions.map((item) => ({
        reference: item.reference,
        amount: item.amount,
        occurredAt: dateOf(item.transactionDateTime),
      }));
      if (
        receipts.some(
          (item) => !item.reference || !Number.isSafeInteger(item.amount) || item.amount <= 0,
        ) ||
        receipts.reduce((sum, item) => sum + item.amount, 0) !== data.amountPaid
      )
        throw new ApiError(409, 'Lịch sử tiền về PayOS không khớp số dư.');
      return {
        status: 'SUCCEEDED',
        eventId: `payos:${data.id}:reconciled:${data.amountPaid}`,
        eventType: 'payment.succeeded',
        providerPaymentId: data.id,
        merchantReference: payment.merchantReference,
        amount: data.amountPaid,
        currency: 'VND',
        occurredAt: receipts.at(-1).occurredAt,
        receipts,
      };
    }
    if (data.amountPaid !== 0)
      throw new ApiError(409, 'Số tiền PayOS không khớp lịch sử giao dịch.');
    return {
      status: ['CANCELLED', 'EXPIRED', 'FAILED'].includes(data.status) ? data.status : 'PENDING',
      underpaid: data.status === 'UNDERPAID',
    };
  }
  async refundPayment() {
    throw new ApiError(
      409,
      'Khoản PayOS cần hoàn bằng chuyển khoản thực tế và lưu chứng từ. Hệ thống không tự động hoàn tiền qua API thu tiền.',
    );
  }
}
module.exports = PayosProvider;
