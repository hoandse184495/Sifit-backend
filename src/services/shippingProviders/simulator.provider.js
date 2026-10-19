const crypto = require('crypto');
const env = require('../../config/env');
const ShippingProviderInterface = require('./shippingProvider.interface');

class SimulatorShippingProvider extends ShippingProviderInterface {
  constructor() {
    super();
    this.name = 'simulator';
    this.capabilities = {
      calculateShippingFee: true,
      createShipment: true,
      cancelShipment: true,
      getTracking: true,
      verifyWebhook: true,
      parseWebhook: true,
    };
  }

  sign(payload) {
    return crypto
      .createHmac('sha256', env.SHIPPING_WEBHOOK_SECRET)
      .update(JSON.stringify(payload))
      .digest('hex');
  }

  verifyWebhook({ payload, signature }) {
    if (!signature) return false;
    const expected = Buffer.from(this.sign(payload), 'hex');
    const actual = Buffer.from(signature, 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }

  parseWebhook(payload) {
    return {
      providerEventId: payload.eventId,
      eventType: payload.eventType,
      providerShipmentId: payload.providerShipmentId,
      trackingNumber: payload.trackingNumber,
      status: payload.status,
      occurredAt: payload.occurredAt ? new Date(payload.occurredAt) : new Date(),
      metadata: payload.metadata || {},
    };
  }

  async calculateShippingFee({ weightGrams, packageLengthCm, packageWidthCm, packageHeightCm }) {
    const volumetricWeight =
      Math.ceil((packageLengthCm * packageWidthCm * packageHeightCm) / 6000) * 1000;
    const billableWeight = Math.max(weightGrams, volumetricWeight);
    return {
      provider: this.name,
      shippingFee: 18000 + Math.ceil(billableWeight / 500) * 3000,
      currency: 'VND',
      estimatedDeliveryAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    };
  }

  async createShipment() {
    const id = crypto.randomUUID();
    return {
      providerShipmentId: `ship_${id}`,
      trackingNumber: `SIFIT${id.replace(/-/g, '').slice(0, 16).toUpperCase()}`,
      status: 'READY_FOR_PICKUP',
      estimatedDeliveryAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    };
  }

  async cancelShipment() {
    return { status: 'CANCELLED' };
  }

  async getTracking(shipment) {
    return { status: shipment.status, trackingNumber: shipment.trackingNumber };
  }
}

module.exports = SimulatorShippingProvider;
