const { PayOS } = require('@payos/node');
const env = require('./env');
const ApiError = require('../utils/ApiError');
let client;
const isConfigured = () =>
  Boolean(env.PAYOS_CLIENT_ID && env.PAYOS_API_KEY && env.PAYOS_CHECKSUM_KEY);
const getClient = () => {
  if (!isConfigured())
    throw new ApiError(
      503,
      'Chưa cấu hình PayOS. Vui lòng điền PAYOS_CLIENT_ID, PAYOS_API_KEY và PAYOS_CHECKSUM_KEY trong backend .env.',
    );
  if (!client)
    client = new PayOS({
      clientId: env.PAYOS_CLIENT_ID,
      apiKey: env.PAYOS_API_KEY,
      checksumKey: env.PAYOS_CHECKSUM_KEY,
      timeout: 15000,
      maxRetries: 0,
      logLevel: 'off',
    });
  return client;
};
module.exports = { getClient, isConfigured };
