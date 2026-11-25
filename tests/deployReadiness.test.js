const path = require('node:path');
const { spawnSync } = require('node:child_process');
const express = require('express');
const request = require('supertest');
const env = require('../src/config/env');
const paymentService = require('../src/services/payment.service');
const { createPayment } = require('../src/controllers/payment.controller');
const errorHandler = require('../src/middlewares/error.middleware');

const productionConfig = (overrides = {}) => spawnSync(process.execPath, ['-e', "console.log(JSON.stringify({ webhookUrl: require('./src/config/env').PAYOS_WEBHOOK_URL }))"], {
  cwd: path.join(__dirname, '..'), encoding: 'utf8',
  env: { ...process.env, NODE_ENV: 'production', JEST_WORKER_ID: '',
    FRONTEND_URL: 'https://demo.example.com', SOCKET_CORS_ORIGIN: 'https://demo.example.com',
    JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40),
    PAYMENT_WEBHOOK_SECRET: 'c'.repeat(40), SHIPPING_WEBHOOK_SECRET: 'd'.repeat(40),
    PAYMENT_PROVIDER: 'payos', PAYMENTS_ENABLED: 'false', PAYOUT_MODE: 'manual',
    SHIPPING_PROVIDER: 'manual', SELLER_VERIFICATION_MODE: 'manual',
    PAYOS_CLIENT_ID: '', PAYOS_API_KEY: '', PAYOS_CHECKSUM_KEY: '', PAYOS_WEBHOOK_URL: '',
    ...overrides },
});

describe('Release configuration and payment switch', () => {
  afterEach(() => { env.PAYMENTS_ENABLED = true; jest.restoreAllMocks(); });
  it('starts a production demo without live payment credentials', () => {
    expect(productionConfig().status).toBe(0);
  });
  it('rejects localhost, non-HTTPS and origins containing a path', () => {
    for (const FRONTEND_URL of ['http://localhost:5173', 'http://demo.example.com', 'https://demo.example.com/path']) {
      expect(productionConfig({ FRONTEND_URL }).status).not.toBe(0);
    }
  });
  it('requires real provider configuration when enabling payments', () => {
    expect(productionConfig({ PAYMENTS_ENABLED: 'true' }).status).not.toBe(0);
  });
  const livePayos = {
    PAYMENTS_ENABLED: 'true', PAYMENT_MODE: 'production',
    PAYOS_CLIENT_ID: 'fixture-client', PAYOS_API_KEY: 'fixture-api',
    PAYOS_CHECKSUM_KEY: 'fixture-checksum',
    PAYOS_WEBHOOK_URL: 'https://api.example.com/api/v1/webhooks/payments/payos',
  };
  it('starts production with complete PayOS configuration and retains the webhook URL', () => {
    const result = productionConfig(livePayos);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).webhookUrl).toBe(livePayos.PAYOS_WEBHOOK_URL);
  });
  it.each([
    '', 'https://', 'http://api.example.com/api/v1/webhooks/payments/payos',
    'https://localhost/api/v1/webhooks/payments/payos',
    'https://api.example.com/',
    'https://api.example.com/api/v1/webhooks/payments/payos?token=secret',
    'https://user:password@api.example.com/api/v1/webhooks/payments/payos',
    'https://api.example.com/api/v1/webhooks/payments/payos#fragment',
  ])('rejects an unusable production webhook: %s', (PAYOS_WEBHOOK_URL) => {
    const result = productionConfig({ ...livePayos, PAYOS_WEBHOOK_URL });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Invalid environment configuration:');
    expect(result.stderr).not.toContain('TypeError');
  });
  it('blocks payment creation before touching provider or database', async () => {
    env.PAYMENTS_ENABLED = false;
    const spy = jest.spyOn(paymentService, 'createPayment');
    const app = express(); app.post('/payment', createPayment); app.use(errorHandler);
    const response = await request(app).post('/payment').expect(503);
    expect(response.body.message).toContain('Không cần chuyển tiền');
    expect(spy).not.toHaveBeenCalled();
  });
});
