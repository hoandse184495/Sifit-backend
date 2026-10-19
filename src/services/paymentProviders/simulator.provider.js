const crypto = require('crypto');
const env = require('../../config/env');
const PaymentProviderInterface = require('./paymentProvider.interface');

class SimulatorProvider extends PaymentProviderInterface {
  constructor() {
    super();
    this.name = 'simulator';
    this.capabilities = {
      createPayment: true,
      queryPayment: true,
      verifyWebhook: true,
      parseWebhook: true,
      refundPayment: true,
      queryRefund: true,
    };
  }

  createSignature(payload) {
    return crypto
      .createHmac('sha256', env.PAYMENT_WEBHOOK_SECRET)
      .update(JSON.stringify(payload))
      .digest('hex');
  }

  verifyWebhook({ payload, signature }) {
    if (!signature) {
      return false;
    }

    const expected = this.createSignature(payload);
    const expectedBuffer = Buffer.from(expected, 'hex');
    const actualBuffer = Buffer.from(signature, 'hex');

    return (
      expectedBuffer.length === actualBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, actualBuffer)
    );
  }

  parseWebhook(payload) {
    return {
      eventId: payload.eventId,
      eventType: payload.eventType,
      providerPaymentId: payload.providerPaymentId,
      merchantReference: payload.merchantReference,
      amount: payload.amount,
      currency: payload.currency,
      occurredAt: payload.occurredAt ? new Date(payload.occurredAt) : new Date(),
      status: payload.status,
    };
  }

  async createPayment({ merchantReference, amount, currency, expiresAt }) {
    const providerPaymentId = `sim_${crypto.randomUUID()}`;

    return {
      providerPaymentId,
      paymentUrl: `${env.PAYMENT_RETURN_URL}?provider=simulator&paymentId=${providerPaymentId}`,
      status: 'PENDING',
      expiresAt,
      amount,
      currency,
      merchantReference,
    };
  }

  async queryPayment() {
    return { status: 'PENDING' };
  }

  async refundPayment({ payment, amount }) {
    return {
      providerRefundId: `sim_ref_${crypto.randomUUID()}`,
      status: 'PENDING',
      amount,
      currency: payment.currency,
    };
  }

  async queryRefund() {
    return { status: 'PENDING' };
  }
}

module.exports = SimulatorProvider;
