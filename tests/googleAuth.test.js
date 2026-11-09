process.env.GOOGLE_CLIENT_ID = '1234567890-test.apps.googleusercontent.com';
const { OAuth2Client } = require('google-auth-library');
const { URL } = require('node:url');
const mongoose = require('mongoose');
const argon2 = require('argon2');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const env = require('../src/config/env');
const User = require('../src/models/user.model');
const AuthSession = require('../src/models/authSession.model');
const Challenge = require('../src/models/googleLoginChallenge.model');
const identity = require('../src/services/googleIdentity.service');

let mongo;
let verifier;
let claims;
let currentIp = 1;
const origin = new URL(env.FRONTEND_URL).origin;
const post = (cookie, body = {}) => request(app).post('/api/v1/auth/google')
  .set('Origin', origin).set('X-Forwarded-For', `127.0.0.${currentIp}`)
  .set('Cookie', cookie || 'unused=1').send({ credential: 'google-token', ...body });
const challenge = async (overrides = {}) => {
  const result = await request(app).get('/api/v1/auth/google/config').expect(200);
  claims = { sub: 'google-user-1', email: 'google@example.com', email_verified: true,
    name: 'Google User', picture: 'https://lh3.googleusercontent.com/avatar', nonce: result.body.data.nonce, ...overrides };
  return result.headers['set-cookie'][0].split(';')[0];
};
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([User.init(), Challenge.init(), AuthSession.init()]);
  verifier = jest.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockImplementation(async () => ({ getPayload: () => claims }));
});
beforeEach(async () => {
  currentIp += 1;
  await Promise.all([User.deleteMany({}), Challenge.deleteMany({}), AuthSession.deleteMany({})]);
  verifier.mockClear();
});
afterAll(async () => { verifier.mockRestore(); await mongoose.disconnect(); await mongo.stop(); });

describe('Google sign-in', () => {
  it('creates a verified buyer, issues the existing JWT/cookie session and supports refresh/logout', async () => {
    const cookie = await challenge();
    const result = await post(cookie).expect(200);
    expect(verifier).toHaveBeenCalledWith({ idToken: 'google-token', audience: process.env.GOOGLE_CLIENT_ID });
    expect(result.body.data.user).toMatchObject({ role: 'BUYER', emailVerified: true, hasPassword: false, googleLinked: true });
    expect(result.body.data.user.googleId).toBeUndefined();
    expect(result.body.data.user.passwordHash).toBeUndefined();
    const refreshCookie = result.headers['set-cookie'].find(value => value.startsWith('refreshToken='));
    expect(refreshCookie).toContain('HttpOnly');
    expect(await Challenge.countDocuments()).toBe(0);
    await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${result.body.data.accessToken}`).expect(200);
    const refreshed = await request(app).post('/api/v1/auth/refresh-token').set('Cookie', refreshCookie.split(';')[0]).expect(200);
    await request(app).post('/api/v1/auth/logout').set('Cookie', refreshed.headers['set-cookie'][0].split(';')[0]).expect(200);
    const user = await User.findOne({ email: claims.email }).select('+passwordHash +googleId');
    expect(user.passwordHash).toBeUndefined();
    expect(user.googleId).toBe(claims.sub);
  });
  it('creates a seller when selected and never changes the role of a returning identity', async () => {
    let cookie = await challenge();
    const first = await post(cookie, { role: 'SELLER' }).expect(200);
    cookie = await challenge();
    const second = await post(cookie, { role: 'BUYER' }).expect(200);
    expect(second.body.data.user.role).toBe('SELLER');
    expect(second.body.data.user.id).toBe(first.body.data.user.id);
    expect(await User.countDocuments()).toBe(1);
  });
  it('rejects self-registration as admin and ignores forged profile fields', async () => {
    const cookie = await challenge();
    await post(cookie, { role: 'ADMIN' }).expect(400);
    const result = await post(cookie, { email: 'attacker@example.com', fullName: 'Spoofed', googleId: 'forged', status: 'SUSPENDED' }).expect(200);
    expect(result.body.data.user).toMatchObject({ email: claims.email, fullName: claims.name, role: 'BUYER', status: 'ACTIVE' });
  });
  it('requires cookie and trusted Origin before accepting an ID token', async () => {
    const cookie = await challenge();
    await post().expect(401);
    await request(app).post('/api/v1/auth/google').set('Cookie', cookie).send({ credential: 'google-token' }).expect(403);
    expect(verifier).not.toHaveBeenCalled();
    await post(cookie).expect(200);
  });
  it('rejects invalid Google signatures/claims, unverified email, missing subject and mismatched nonce', async () => {
    let cookie = await challenge();
    verifier.mockRejectedValueOnce(new Error('Invalid signature/audience/expiration'));
    await post(cookie).expect(401);
    for (const invalid of [{ email_verified: false }, { sub: '' }, { email: 'invalid' }, { nonce: 'wrong-browser' }]) {
      cookie = await challenge(invalid);
      await post(cookie).expect(401);
    }
    expect(await User.countDocuments()).toBe(0);
  });
  it('rejects expired and replayed browser challenges, including concurrent submissions', async () => {
    let cookie = await challenge();
    await Challenge.updateMany({}, { expiresAt: new Date(Date.now() - 1000) });
    await post(cookie).expect(401);
    cookie = await challenge();
    const responses = await Promise.all([post(cookie), post(cookie)]);
    expect(responses.map(result => result.status).sort()).toEqual([200, 401]);
    await post(cookie).expect(401);
    expect(await User.countDocuments()).toBe(1);
  });
  it('requires the existing account password before linking and preserves role, password and user id', async () => {
    const password = 'ExistingPassword123!';
    const existing = await User.create({ fullName: 'Existing Seller', email: 'google@example.com', role: 'SELLER', passwordHash: await argon2.hash(password) });
    const cookie = await challenge();
    const confirmation = await post(cookie).expect(409);
    expect(confirmation.body.errors).toContainEqual({ code: 'GOOGLE_LINK_REQUIRED' });
    await post(cookie, { currentPassword: 'WrongPassword123!' }).expect(401);
    expect((await User.findById(existing._id).select('+googleId')).googleId).toBeUndefined();
    const linked = await post(cookie, { role: 'BUYER', currentPassword: password }).expect(200);
    expect(linked.body.data.user).toMatchObject({ id: existing.id, role: 'SELLER', hasPassword: true, googleLinked: true });
    await request(app).post('/api/v1/auth/login').send({ email: existing.email, password }).expect(200);
    expect(await User.countDocuments()).toBe(1);
  });
  it('finds returning users by stable Google subject even when their Google email changes', async () => {
    const cookie = await challenge();
    const first = await post(cookie).expect(200);
    const nextCookie = await challenge({ email: 'changed@example.com' });
    const next = await post(nextCookie).expect(200);
    expect(next.body.data.user.id).toBe(first.body.data.user.id);
    expect(await User.countDocuments()).toBe(1);
  });
  it('rejects suspended identities and emails already linked to a different Google identity', async () => {
    await User.create({ fullName: 'Other Google', email: 'google@example.com', googleId: 'other-subject', authProvider: 'google' });
    let cookie = await challenge();
    await post(cookie).expect(409);
    await User.updateOne({ email: claims.email }, { status: 'SUSPENDED' });
    cookie = await challenge({ sub: 'other-subject' });
    await post(cookie).expect(403);
    expect(await AuthSession.countDocuments()).toBe(0);
  });
  it('fails safely on password login/change-password for Google-only users', async () => {
    const cookie = await challenge();
    const loggedIn = await post(cookie).expect(200);
    await request(app).post('/api/v1/auth/login').send({ email: claims.email, password: 'Anything123!' }).expect(401);
    await request(app).patch('/api/v1/auth/change-password').set('Authorization', `Bearer ${loggedIn.body.data.accessToken}`)
      .send({ currentPassword: 'Anything123!', newPassword: 'AnotherPassword123!' }).expect(409);
  });
  it('returns an unavailable configuration when no client ID is configured', async () => {
    const previous = env.GOOGLE_CLIENT_ID;
    env.GOOGLE_CLIENT_ID = '';
    try {
      const config = await request(app).get('/api/v1/auth/google/config').expect(200);
      expect(config.body.data).toEqual({ enabled: false });
      await expect(identity.createChallenge()).rejects.toMatchObject({ statusCode: 503 });
    } finally { env.GOOGLE_CLIENT_ID = previous; }
  });
});
