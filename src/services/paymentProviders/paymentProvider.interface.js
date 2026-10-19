class PaymentProviderInterface {
  constructor() {
    this.capabilities = {
      createPayment: false,
      queryPayment: false,
      verifyWebhook: false,
      parseWebhook: false,
      refundPayment: false,
      queryRefund: false,
    };
  }

  createPayment() {
    throw new Error('createPayment is not implemented');
  }

  queryPayment() {
    throw new Error('queryPayment is not implemented');
  }

  verifyWebhook() {
    throw new Error('verifyWebhook is not implemented');
  }

  parseWebhook() {
    throw new Error('parseWebhook is not implemented');
  }

  refundPayment() {
    throw new Error('refundPayment is not implemented');
  }

  queryRefund() {
    throw new Error('queryRefund is not implemented');
  }
}

module.exports = PaymentProviderInterface;
