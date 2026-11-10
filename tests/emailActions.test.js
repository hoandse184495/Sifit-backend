const mongoose = require('mongoose');
const crypto = require('node:crypto');
const argon2 = require('argon2');
const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const app = require('../src/app');
const User = require('../src/models/user.model');
const Action = require('../src/models/emailAction.model');
const Delivery = require('../src/models/mailDelivery.model');
const Session = require('../src/models/authSession.model');
const service = require('../src/services/emailAction.service');
const mail = require('../src/services/mail.service');
const { signAccessToken } = require('../src/utils/token');
let mongo, user, admin;
const linkToken = async purpose => {
  const action = await Action.findOne({ userId: user._id, purpose }).sort({ createdAt: -1 });
  const delivery = await Delivery.findOne({ actionId: action._id }).select('+encrypted');
  const message = mail.decrypt(delivery.encrypted);
  return { action, delivery, token: /#token=([a-f0-9]{64})/.exec(message.text)[1] };
};
beforeAll(async () => { mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(mongo.getUri()); await Promise.all(Object.values(mongoose.models).map(m => m.init())); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => {
  jest.restoreAllMocks(); await Promise.all(Object.values(mongoose.models).map(m => m.deleteMany({})));
  user = await User.create({ fullName: 'Email test', email: 'email@account.test', passwordHash: await argon2.hash('Previous123!'), role: 'BUYER' });
  admin = await User.create({ fullName: 'Admin', email: 'admin@account.test', passwordHash: 'unused', role: 'ADMIN' });
});
it('returns the same public forgot-password result for known and unknown accounts without revealing tokens', async () => {
  const known = await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email }).expect(200);
  const unknown = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'unknown@account.test' }).expect(200);
  expect(known.body).toEqual(unknown.body);
  const { token } = await linkToken('reset');
  expect(JSON.stringify(known.body)).not.toContain(token);
  expect((await Action.findOne().select('+tokenHash')).tokenHash).toBe(crypto.createHash('sha256').update(token).digest('hex'));
  expect((await Delivery.findOne().select('+encrypted')).encrypted).not.toContain(token);
});
it('changes the password once and revokes old access and refresh sessions', async () => {
  const oldToken = signAccessToken(user);
  await Session.create({ user: user._id, familyId: 'family', tokenIdHash: 'old', expiresAt: new Date(Date.now() + 86400000) });
  await service.issue(user.email, 'reset'); const { token } = await linkToken('reset');
  await service.consume('reset', token, 'Replacement123!');
  expect(await argon2.verify((await User.findById(user._id).select('+passwordHash')).passwordHash, 'Replacement123!')).toBe(true);
  expect((await Session.findOne()).revokedReason).toBe('password_reset');
  await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${oldToken}`).expect(401);
  await expect(service.consume('reset', token, 'AnotherPass123!')).rejects.toMatchObject({ statusCode: 400 });
});
it('allows only one concurrent consumer', async () => {
  await service.issue(user.email, 'reset'); const { token } = await linkToken('reset');
  const results = await Promise.allSettled([service.consume('reset', token, 'NewPassword123!'), service.consume('reset', token, 'NewPassword456!')]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
});
it('queues verification atomically with registration when email is configured', async () => {
  jest.spyOn(mail, 'configured').mockReturnValue(true);
  const auth = require('../src/services/auth.service');
  await auth.register({ fullName: 'New account', email: 'new@account.test', password: 'Registration123!' });
  const created = await User.findOne({ email: 'new@account.test' });
  expect(await Action.countDocuments({ userId: created._id, purpose: 'verify' })).toBe(1);
  jest.spyOn(Delivery, 'create').mockRejectedValueOnce(new Error('Queue unavailable'));
  await expect(auth.register({ fullName: 'Rolled back', email: 'rollback@account.test', password: 'Registration123!' })).rejects.toThrow('Queue unavailable');
  expect(await User.exists({ email: 'rollback@account.test' })).toBeNull();
});
it('rejects expired, replaced and wrong-purpose tokens', async () => {
  await service.issue(user.email, 'reset'); const first = await linkToken('reset');
  await expect(service.consume('verify', first.token)).rejects.toMatchObject({ statusCode: 400 });
  await Action.collection.updateOne({ _id: first.action._id }, { $set: { createdAt: new Date(Date.now() - 120000) } });
  await service.issue(user.email, 'reset'); const next = await linkToken('reset');
  await expect(service.consume('reset', first.token, 'NewPassword123!')).rejects.toMatchObject({ statusCode: 400 });
  await Action.updateOne({ _id: next.action._id }, { expiresAt: new Date(Date.now() - 1000) });
  await expect(service.consume('reset', next.token, 'NewPassword123!')).rejects.toMatchObject({ statusCode: 400 });
});
it('verifies an email once and keeps resends within the cooldown from invalidating the first link', async () => {
  await service.issue(user.email, 'verify'); const { token } = await linkToken('verify');
  await service.issue(user.email, 'verify'); expect(await Action.countDocuments()).toBe(1);
  await service.consume('verify', token); expect((await User.findById(user._id)).emailVerified).toBe(true);
  await expect(service.consume('verify', token)).rejects.toMatchObject({ statusCode: 400 });
});
it('does not create local reset credentials for Google-only or suspended users', async () => {
  await User.updateOne({ _id: user._id }, { authProvider: 'google', $unset: { passwordHash: 1 } });
  await service.issue(user.email, 'reset'); expect(await Delivery.countDocuments()).toBe(0);
  await User.updateOne({ _id: user._id }, { status: 'SUSPENDED' });
  await service.issue(user.email, 'verify'); expect(await Delivery.countDocuments()).toBe(0);
});
it('records safe SMTP failure metadata, protects encrypted payloads and supports an audited admin retry', async () => {
  await service.issue(user.email, 'verify'); const item = (await linkToken('verify')).delivery;
  await Delivery.updateOne({ _id: item._id }, { attempts: 4 });
  jest.spyOn(mail, 'send').mockRejectedValue(new Error('secret smtp-password must never be exposed'));
  await mail.processBatch(); expect((await Delivery.findById(item._id)).status).toBe('FAILED');
  const auth = { Authorization: `Bearer ${signAccessToken(admin)}` };
  const list = await request(app).get('/api/v1/admin/operations/mail').set(auth).expect(200);
  expect(JSON.stringify(list.body)).not.toMatch(/encrypted|smtp-password|#token/);
  await request(app).post(`/api/v1/admin/operations/mail/${item._id}/retry`).set('Authorization', `Bearer ${signAccessToken(user)}`).send({ reason: 'Retry after SMTP setup' }).expect(403);
  await request(app).post(`/api/v1/admin/operations/mail/${item._id}/retry`).set(auth).send({ reason: 'Retry after SMTP setup' }).expect(200);
  mail.send.mockResolvedValue(); await mail.processBatch(); expect((await Delivery.findById(item._id)).status).toBe('SENT');
});
it('does not send expired actions or allow weak passwords', async () => {
  await service.issue(user.email, 'reset'); const { action, token } = await linkToken('reset');
  await request(app).post('/api/v1/auth/reset-password').send({ token, newPassword: 'weak' }).expect(400);
  await Action.updateOne({ _id: action._id }, { consumedAt: new Date() });
  const send = jest.spyOn(mail, 'send'); await mail.processBatch(); expect(send).not.toHaveBeenCalled();
});
