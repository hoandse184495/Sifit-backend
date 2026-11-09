const express = require('express');
const request = require('supertest');
const crypto = require('node:crypto');
const { createRateLimiters } = require('../src/middlewares/rateLimit.middleware');
const { signAccessToken } = require('../src/utils/token');
let app;
const token = () => signAccessToken({ id: crypto.randomBytes(12).toString('hex'), role: 'BUYER' });
const call = (method, path, bearer, ip = '127.0.0.1') => {
  const operation = request(app)[method](`/api/v1${path}`).set('X-Forwarded-For', ip);
  return bearer ? operation.set('Authorization', `Bearer ${bearer}`) : operation;
};
const configure = (options = {}) => {
  const limits = createRateLimiters({
    readLimit: 2,
    writeLimit: 2,
    loginLimit: 4,
    identityLimit: 2,
    googleLimit: 2,
    registerLimit: 2,
    sessionLimit: 3,
    webhookLimit: 2,
    ...options,
  });
  app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.post('/api/v1/webhooks/payments/payos', limits.paymentWebhookLimiter, (_req, res) =>
    res.json({ ok: true }),
  );
  app.use('/api/v1', limits.apiLimiter);
  app.get('/api/v1/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/v1/products', (_req, res) => res.json({ ok: true }));
  app.post('/api/v1/products', (_req, res) => res.json({ ok: true }));
  app.post('/api/v1/auth/login', limits.loginLimiter, limits.loginIdentityLimiter, (req, res) =>
    res.status(req.body.ok ? 200 : 401).json({ ok: Boolean(req.body.ok) }),
  );
  app.post('/api/v1/auth/google', limits.googleLoginLimiter, (req, res) =>
    res.status(req.body.ok ? 200 : 401).json({ ok: Boolean(req.body.ok) }),
  );
  app.post('/api/v1/auth/register', limits.registerLimiter, (_req, res) =>
    res.status(201).json({ ok: true }),
  );
  app.post('/api/v1/auth/refresh-token', limits.authSessionLimiter, (_req, res) =>
    res.json({ ok: true }),
  );
  app.post('/api/v1/auth/logout', limits.authSessionLimiter, (_req, res) => res.json({ ok: true }));
};
beforeEach(() => configure());
describe('Independent API budgets', () => {
  it('keeps writes and login available after exhausting reads', async () => {
    await call('get', '/products').expect(200);
    await call('get', '/products').expect(200);
    await call('get', '/products').expect(429);
    await call('post', '/products').send({}).expect(200);
    await call('post', '/auth/login').send({ email: 'buyer@fixture.test', ok: true }).expect(200);
  });
  it('keeps reads available after exhausting writes', async () => {
    await call('post', '/products').expect(200);
    await call('post', '/products').expect(200);
    await call('post', '/products').expect(429);
    await call('get', '/products').expect(200);
  });
  it('gives verified users behind the same IP independent budgets', async () => {
    const buyer = token(),
      seller = token();
    await call('get', '/products', buyer).expect(200);
    await call('get', '/products', buyer).expect(200);
    await call('get', '/products', buyer).expect(429);
    await call('get', '/products', seller).expect(200);
    await call('get', '/products').expect(200);
  });
  it('does not trust a forged JWT to select another user budget', async () => {
    const victim = token(),
      forged = victim.slice(0, -2) + 'xx';
    await call('get', '/products', forged).expect(200);
    await call('get', '/products', forged).expect(200);
    await call('get', '/products', 'not-a-token').expect(429);
    await call('get', '/products', victim).expect(200);
  });
  it('does not charge health checks to customer traffic', async () => {
    for (let i = 0; i < 8; i++) await call('get', '/health').expect(200);
    await call('get', '/products').expect(200);
    await call('get', '/products').expect(200);
    await call('get', '/products').expect(429);
    await call('get', '/health').expect(200);
  });
  it('returns a Vietnamese explanation and a usable retry time', async () => {
    await call('get', '/products');
    await call('get', '/products');
    const result = await call('get', '/products').expect(429);
    expect(result.body.code).toBe('RATE_LIMITED');
    expect(result.body.scope).toBe('api-read');
    expect(result.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.body.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(Number(result.headers['retry-after'])).toBe(result.body.retryAfterSeconds);
    expect(result.body.message).toContain('Vui lòng thử lại');
  });
  it('groups IPv6 addresses within the same subnet', async () => {
    await call('get', '/products', null, '2001:db8:1234:5601::1').expect(200);
    await call('get', '/products', null, '2001:db8:1234:56ff::2').expect(200);
    await call('get', '/products', null, '2001:db8:1234:5602::3').expect(429);
  });
  it('protects webhooks separately from browsing and login', async () => {
    await call('get', '/products');
    await call('get', '/products');
    await call('get', '/products').expect(429);
    await call('post', '/webhooks/payments/payos').expect(200);
    await call('post', '/webhooks/payments/payos').expect(200);
    await call('post', '/webhooks/payments/payos').expect(429);
    await call('post', '/auth/login').send({ ok: true }).expect(200);
  });
});
describe('Sign-in abuse protection', () => {
  it('counts failures for the same IP/email without blocking product reads', async () => {
    for (let i = 0; i < 2; i++)
      await call('post', '/auth/login').send({ email: 'BUYER@fixture.test' }).expect(401);
    const result = await call('post', '/auth/login')
      .send({ email: ' buyer@fixture.test ' })
      .expect(429);
    expect(result.body.scope).toBe('auth-signin-identity');
    await call('get', '/products').expect(200);
    await call('post', '/auth/login').send({ email: 'other@fixture.test', ok: true }).expect(200);
  });
  it('also limits attackers who vary the email address', async () => {
    configure({ loginLimit: 2, identityLimit: 10 });
    await call('post', '/auth/login').send({ email: 'one@fixture.test' }).expect(401);
    await call('post', '/auth/login').send({ email: 'two@fixture.test' }).expect(401);
    expect(
      (await call('post', '/auth/login').send({ email: 'three@fixture.test' }).expect(429)).body
        .scope,
    ).toBe('auth-signin-ip');
  });
  it('does not penalize normal successful sign-ins', async () => {
    for (let i = 0; i < 6; i++)
      await call('post', '/auth/login').send({ email: 'buyer@fixture.test', ok: true }).expect(200);
  });
  it('keeps Google success and failure counters independent of password login', async () => {
    for (let i = 0; i < 4; i++) await call('post', '/auth/google').send({ ok: true }).expect(200);
    await call('post', '/auth/google').send({}).expect(401);
    await call('post', '/auth/google').send({}).expect(401);
    await call('post', '/auth/google').send({}).expect(429);
    await call('post', '/auth/login').send({ email: 'buyer@fixture.test', ok: true }).expect(200);
  });
  it('limits account creation even when submissions succeed', async () => {
    await call('post', '/auth/register').expect(201);
    await call('post', '/auth/register').expect(201);
    await call('post', '/auth/register').expect(429);
    await call('get', '/products').expect(200);
  });
  it('reserves a separate budget for refresh and logout', async () => {
    await call('get', '/products');
    await call('get', '/products');
    await call('get', '/products').expect(429);
    await call('post', '/auth/refresh-token').expect(200);
    await call('post', '/auth/refresh-token').expect(200);
    await call('post', '/auth/logout').expect(200);
    await call('post', '/auth/refresh-token').expect(429);
    await call('post', '/auth/login').send({ ok: true }).expect(200);
  });
});
