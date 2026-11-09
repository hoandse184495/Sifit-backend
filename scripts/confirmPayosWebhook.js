const { URL } = require('url');
const env = require('../src/config/env');
const payos = require('../src/config/payos');
const value = process.argv[2] || process.env.PAYOS_WEBHOOK_URL;
const run = async () => {
  const url = new URL(value || '');
  if (
    url.protocol !== 'https:' ||
    url.pathname !== '/api/v1/webhooks/payments/payos' ||
    url.username ||
    url.password
  )
    throw new Error('Use an HTTPS URL ending in /api/v1/webhooks/payments/payos');
  if (env.PAYMENT_PROVIDER !== 'payos') throw new Error('PAYMENT_PROVIDER must be payos');
  await payos.getClient().webhooks.confirm(url.href);
  console.log(`PayOS webhook registered: ${url.href}`);
};
run().catch((error) => {
  console.error(
    `Could not register PayOS webhook (status ${error.status || error.statusCode || 'configuration/network'}). Check keys, HTTPS reachability and backend logs.`,
  );
  process.exitCode = 1;
});
