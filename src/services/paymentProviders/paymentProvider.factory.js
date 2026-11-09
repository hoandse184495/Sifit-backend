const env = require('../../config/env');
const SimulatorProvider = require('./simulator.provider');
const PayosProvider = require('./payos.provider');

const getPaymentProvider = (providerName = env.PAYMENT_PROVIDER) => {
  if (providerName === 'payos') return new PayosProvider();
  if (providerName === 'simulator') {
    if (env.NODE_ENV === 'production') {
      throw new Error('Simulator provider is not available in production');
    }

    return new SimulatorProvider();
  }

  throw new Error(`Unsupported payment provider: ${providerName}`);
};

module.exports = {
  getPaymentProvider,
};
