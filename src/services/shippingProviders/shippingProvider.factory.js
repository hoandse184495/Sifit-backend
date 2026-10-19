const env = require('../../config/env');
const SimulatorShippingProvider = require('./simulator.provider');

const getShippingProvider = (providerName = env.SHIPPING_PROVIDER) => {
  if (providerName === 'simulator') {
    if (env.NODE_ENV === 'production') {
      throw new Error('Simulator shipping provider is not available in production');
    }
    return new SimulatorShippingProvider();
  }

  throw new Error(`Unsupported shipping provider: ${providerName}`);
};

module.exports = { getShippingProvider };
