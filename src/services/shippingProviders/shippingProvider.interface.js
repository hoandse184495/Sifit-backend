class ShippingProviderInterface {
  constructor() {
    this.capabilities = {
      calculateShippingFee: false,
      createShipment: false,
      cancelShipment: false,
      getTracking: false,
      verifyWebhook: false,
      parseWebhook: false,
    };
  }
}

module.exports = ShippingProviderInterface;
