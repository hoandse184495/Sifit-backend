process.env.SOCKET_IO_ENABLED = 'true';
const http = require('node:http');
const crypto = require('node:crypto');
const { setTimeout } = require('node:timers');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { io: createClient } = require('socket.io-client');
const app = require('../src/app');
const sockets = require('../src/socket');
const User = require('../src/models/user.model');
const Session = require('../src/models/authSession.model');
const Conversation = require('../src/models/conversation.model');
const Message = require('../src/models/message.model');
const Shop = require('../src/models/sellerProfile.model');
const Audit = require('../src/models/adminAuditLog.model');
const auditService = require('../src/services/adminAudit.service');
const userService = require('../src/services/adminUser.service');
const { signAccessToken } = require('../src/utils/token');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let mongo, server, buyer, seller, adminA, adminB, conversation;
let clients = [];
const call = (method, endpoint, user = adminA) => {
  const agent = request(app);
  return agent[method](`/api/v1${endpoint}`)
    .set('Authorization', `Bearer ${signAccessToken(user)}`)
    .set('X-Forwarded-For', '127.0.0.1');
};
const connect = async (user, expectFailure = false) => {
  const client = createClient(`http://127.0.0.1:${server.address().port}`, {
    auth: { token: signAccessToken(user) },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  clients.push(client);
  return new Promise((resolve, reject) => {
    client.once('connect', () =>
      expectFailure ? reject(new Error('Unexpected connection')) : resolve(client),
    );
    client.once('connect_error', (error) => (expectFailure ? resolve(error) : reject(error)));
  });
};
const emit = (client, event, body) =>
  new Promise((resolve, reject) =>
    client
      .timeout(4000)
      .emit(event, body, (error, result) => (error ? reject(error) : resolve(result))),
  );
const text = (content) => ({
  conversationId: conversation.id,
  type: 'TEXT',
  content,
  clientMessageId: crypto.randomUUID(),
});
const until = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await delay(20);
  }
  throw new Error('Expected state did not arrive');
};
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  server = http.createServer(app);
  sockets.initSocket(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
});
afterAll(async () => {
  await sockets.closeSocket();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await delay(100);
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  jest.restoreAllMocks();
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
  [buyer, seller, adminA, adminB] = await User.create(
    ['BUYER', 'SELLER', 'ADMIN', 'ADMIN'].map((role, i) => ({
      role,
      fullName: `Guard fixture ${i}`,
      email: `guard-${i}@fixture.test`,
      passwordHash: 'fixture',
    })),
  );
  conversation = await Conversation.create({
    buyerId: buyer._id,
    sellerId: seller._id,
    participants: [buyer._id, seller._id],
    productId: new mongoose.Types.ObjectId(),
  });
});
afterEach(async () => {
  clients.forEach((client) => client.disconnect());
  clients = [];
  await delay(100);
  jest.restoreAllMocks();
});
describe('Suspended chat connections', () => {
  it('installs handlers before the first immediate join and send', async () => {
    const client = await connect(buyer);
    expect((await emit(client, 'conversation:join', { conversationId: conversation.id })).ok).toBe(
      true,
    );
    expect((await emit(client, 'message:send', text('First message'))).ok).toBe(true);
  });
  it('disconnects every tab, revokes sessions and prevents messages being received after suspension', async () => {
    const first = await connect(buyer),
      second = await connect(buyer),
      sell = await connect(seller);
    await emit(first, 'conversation:join', { conversationId: conversation.id });
    await emit(second, 'conversation:join', { conversationId: conversation.id });
    await emit(sell, 'conversation:join', { conversationId: conversation.id });
    await Session.create({
      user: buyer._id,
      familyId: crypto.randomUUID(),
      tokenIdHash: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 3600000),
    });
    let received = 0,
      notices = 0;
    for (const client of [first, second]) {
      client.on('message:new', () => received++);
      client.on('account:suspended', () => notices++);
    }
    await call('patch', `/admin/users/${buyer.id}/status`)
      .send({ status: 'SUSPENDED', reason: 'Abusive account fixture' })
      .expect(200);
    await until(() => !first.connected && !second.connected);
    expect(notices).toBe(2);
    expect((await Session.findOne({ user: buyer._id })).revokedAt).toBeInstanceOf(Date);
    expect((await emit(sell, 'message:send', text('Seller after suspension'))).ok).toBe(true);
    await delay(100);
    expect(received).toBe(0);
    await call('post', `/conversations/${conversation.id}/messages`, buyer)
      .send(text('REST rejected'))
      .expect(403);
    expect((await connect(buyer, true)).message).toMatch(/suspended/i);
  });
  it('rechecks account status on a packet even if status changed outside the admin endpoint', async () => {
    const client = await connect(buyer);
    await emit(client, 'conversation:join', { conversationId: conversation.id });
    await User.updateOne({ _id: buyer._id }, { status: 'SUSPENDED' });
    const result = await emit(client, 'message:send', text('Must not persist')).catch(() => null);
    expect(result?.ok || false).toBe(false);
    await until(() => !client.connected);
    expect(await Message.countDocuments({})).toBe(0);
  });
  it('rechecks typing and room joins rather than only message sending', async () => {
    const client = await connect(buyer);
    await emit(client, 'conversation:join', { conversationId: conversation.id });
    await User.updateOne({ _id: buyer._id }, { status: 'SUSPENDED' });
    const result = await emit(client, 'typing:start', { conversationId: conversation.id }).catch(
      () => null,
    );
    expect(result?.ok || false).toBe(false);
    await until(() => !client.connected);
    expect(sockets.getIo().sockets.sockets.has(client.id)).toBe(false);
  });
  it('also disconnects chat when an admin suspends the seller through shop management', async () => {
    const shop = await Shop.create({
      userId: seller._id,
      shopName: 'Guard shop',
      shopSlug: 'guard-shop',
    });
    const client = await connect(seller);
    await emit(client, 'conversation:join', { conversationId: conversation.id });
    await call('patch', `/admin/sellers/${shop.id}/status`)
      .send({ status: 'SUSPENDED', reason: 'Shop policy violation' })
      .expect(200);
    await until(() => !client.connected);
    expect((await User.findById(seller.id)).status).toBe('SUSPENDED');
  });
  it('does not disconnect or revoke a user when the status transaction rolls back', async () => {
    const client = await connect(buyer);
    await emit(client, 'conversation:join', { conversationId: conversation.id });
    await Session.create({
      user: buyer._id,
      familyId: crypto.randomUUID(),
      tokenIdHash: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 3600000),
    });
    const disconnect = jest.spyOn(sockets, 'disconnectUser');
    jest.spyOn(auditService, 'record').mockRejectedValue(new Error('Audit unavailable'));
    await call('patch', `/admin/users/${buyer.id}/status`)
      .send({ status: 'SUSPENDED', reason: 'Rollback fixture' })
      .expect(500);
    expect((await User.findById(buyer.id)).status).toBe('ACTIVE');
    expect((await Session.findOne({ user: buyer._id })).revokedAt).toBeFalsy();
    expect(disconnect).not.toHaveBeenCalled();
    expect(client.connected).toBe(true);
    expect((await emit(client, 'message:send', text('Still active'))).ok).toBe(true);
  });
});
describe('Atomic administrator status changes', () => {
  it('keeps one active admin when two admins concurrently suspend each other, repeatedly', async () => {
    for (let trial = 0; trial < 3; trial++) {
      await User.updateMany({ _id: { $in: [adminA._id, adminB._id] } }, { status: 'ACTIVE' });
      const results = await Promise.all([
        call('patch', `/admin/users/${adminB.id}/status`, adminA).send({
          status: 'SUSPENDED',
          reason: 'Concurrent action A',
        }),
        call('patch', `/admin/users/${adminA.id}/status`, adminB).send({
          status: 'SUSPENDED',
          reason: 'Concurrent action B',
        }),
      ]);
      expect(results.filter((result) => result.status === 200)).toHaveLength(1);
      expect(results.some((result) => [403, 409].includes(result.status))).toBe(true);
      expect(await User.countDocuments({ role: 'ADMIN', status: 'ACTIVE' })).toBe(1);
    }
    expect(await Audit.countDocuments({ action: 'USER_SUSPENDED' })).toBe(3);
  });
  it('allows the surviving administrator to reinstate the other account', async () => {
    await call('patch', `/admin/users/${adminB.id}/status`)
      .send({ status: 'SUSPENDED', reason: 'Temporary suspension' })
      .expect(200);
    await call('patch', `/admin/users/${adminB.id}/status`)
      .send({ status: 'ACTIVE', reason: 'Reviewed and restored' })
      .expect(200);
    expect(await User.countDocuments({ role: 'ADMIN', status: 'ACTIVE' })).toBe(2);
  });
  it('rejects a stale actor object after that administrator was suspended', async () => {
    await User.updateOne({ _id: adminB._id }, { status: 'SUSPENDED' });
    await expect(
      userService.updateUserStatus({
        admin: adminB,
        id: adminA._id,
        status: 'SUSPENDED',
        reason: 'Stale actor',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await User.findById(adminA.id)).status).toBe('ACTIVE');
  });
  it('preserves the self-suspension guard and commits audit with a successful change', async () => {
    await call('patch', `/admin/users/${adminA.id}/status`)
      .send({ status: 'SUSPENDED', reason: 'Self suspension' })
      .expect(409);
    expect(await User.countDocuments({ role: 'ADMIN', status: 'ACTIVE' })).toBe(2);
    expect(await Audit.countDocuments({})).toBe(0);
    await call('patch', `/admin/users/${buyer.id}/status`)
      .send({ status: 'SUSPENDED', reason: 'Verified abuse report' })
      .expect(200);
    expect(await Audit.countDocuments({ action: 'USER_SUSPENDED', resourceId: buyer._id })).toBe(1);
  });
});
