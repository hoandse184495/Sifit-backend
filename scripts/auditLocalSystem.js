// Diagnostic probes only. All users, bank-free data and sockets are disposable.
Object.assign(process.env, {
  NODE_ENV: 'test',
  BACKGROUND_JOBS_ENABLED: 'false',
  PAYMENT_PROVIDER: 'simulator',
  SHIPPING_PROVIDER: 'simulator',
  PAYOUT_MODE: 'simulation',
  SOCKET_IO_ENABLED: 'true',
  PAYOS_CLIENT_ID: '',
  PAYOS_API_KEY: '',
  PAYOS_CHECKSUM_KEY: '',
});
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { setTimeout, clearTimeout } = require('node:timers');
const mongoose = require('mongoose');
const request = require('supertest');
const { io: createClient } = require('socket.io-client');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = async () => {
  const mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { downloadDir: path.resolve('node_modules/.cache/mongodb-memory-server') },
  });
  process.env.MONGODB_URI = mongo.getUri();
  const app = require('../src/app');
  const socket = require('../src/socket');
  const User = require('../src/models/user.model');
  const Conversation = require('../src/models/conversation.model');
  const Message = require('../src/models/message.model');
  const { signAccessToken } = require('../src/utils/token');
  const { apiLimiter } = require('../src/middlewares/rateLimit.middleware');
  const server = http.createServer(app);
  const clients = [];
  const results = {};
  const call = (method, endpoint, user) => {
    const requester = request(app);
    const operation = requester[method](`/api/v1${endpoint}`).set('X-Forwarded-For', '127.0.0.1');
    return user ? operation.set('Authorization', `Bearer ${signAccessToken(user)}`) : operation;
  };
  try {
    await mongoose.connect(mongo.getUri());
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
    socket.initSocket(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const [buyer, seller, admin] = await User.create(
      ['BUYER', 'SELLER', 'ADMIN'].map((role, i) => ({
        fullName: `Audit fixture ${role}`,
        email: `audit-local-${i}@fixture.test`,
        role,
        passwordHash: 'fixture',
      })),
    );
    const conversation = await Conversation.create({
      buyerId: buyer._id,
      sellerId: seller._id,
      productId: new mongoose.Types.ObjectId(),
      participants: [buyer._id, seller._id],
    });
    const connect = async (user) => {
      const client = createClient(`http://127.0.0.1:${server.address().port}`, {
        auth: { token: signAccessToken(user) },
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
      });
      clients.push(client);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Socket connect timeout')), 5000);
        client.once('connect', () => {
          clearTimeout(timer);
          resolve();
        });
        client.once('connect_error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
      // Wait for server handlers, which are installed after asynchronous presence.
      for (let i = 0; i < 100; i++) {
        if (socket.getIo().sockets.sockets.get(client.id)?.eventNames().includes('message:send'))
          return client;
        await delay(25);
      }
      throw new Error('Socket message handlers were not installed');
    };
    const send = (client, event, payload) =>
      new Promise((resolve, reject) =>
        client
          .timeout(4000)
          .emit(event, payload, (error, ack) => (error ? reject(error) : resolve(ack))),
      );
    const buyerSocket = await connect(buyer);
    const sellerSocket = await connect(seller);
    await send(buyerSocket, 'conversation:join', { conversationId: conversation.id });
    await send(sellerSocket, 'conversation:join', { conversationId: conversation.id });
    const suspended = await call('patch', `/admin/users/${buyer.id}/status`, admin).send({
      status: 'SUSPENDED',
      reason: 'Disposable audit suspension',
    });
    const rest = await call('post', `/conversations/${conversation.id}/messages`, buyer).send({
      type: 'TEXT',
      content: 'REST after suspension',
      clientMessageId: crypto.randomUUID(),
    });
    await delay(150);
    const socketResult = buyerSocket.connected
      ? await send(buyerSocket, 'message:send', {
          conversationId: conversation.id,
          type: 'TEXT',
          content: 'SOCKET after suspension',
          clientMessageId: crypto.randomUUID(),
        }).catch(() => ({ ok: false }))
      : { ok: false };
    let suspendedReceived = false;
    buyerSocket.on('message:new', (data) => {
      if (data.message?.content === 'ACTIVE SELLER response') suspendedReceived = true;
    });
    await send(sellerSocket, 'message:send', {
      conversationId: conversation.id,
      type: 'TEXT',
      content: 'ACTIVE SELLER response',
      clientMessageId: crypto.randomUUID(),
    });
    await delay(150);
    results.suspendedSocket = {
      suspendHTTP: suspended.status,
      restSendHTTP: rest.status,
      socketStillConnected: buyerSocket.connected,
      socketSendAccepted: socketResult.ok,
      messagePersisted: Boolean(
        await Message.exists({ senderId: buyer._id, content: 'SOCKET after suspension' }),
      ),
      receivesNewMessages: suspendedReceived,
    };

    // Reset the test IP only between independent probes, not during the budget probe.
    apiLimiter.resetKey('127.0.0.1');
    let allowed = 0;
    for (let i = 0; i < 100; i++) {
      if ((await call('get', '/health')).status === 200) allowed++;
    }
    results.sharedRateBudget = {
      allowedHealthRequests: allowed,
      nextPublicRequestHTTP: (await call('get', '/categories')).status,
      loginAfterReadBudgetHTTP: (
        await call('post', '/auth/login').send({
          email: 'audit@fixture.test',
          password: 'No real credentials',
        })
      ).status,
    };
    apiLimiter.resetKey('127.0.0.1');

    // Two admins concurrently suspending each other must not leave zero admins.
    await User.updateOne({ _id: admin._id }, { status: 'SUSPENDED' });
    const [adminA, adminB] = await User.create(
      ['a', 'b'].map((suffix) => ({
        fullName: `Audit administrator ${suffix}`,
        email: `admin-${suffix}@fixture.test`,
        role: 'ADMIN',
        passwordHash: 'fixture',
      })),
    );
    results.lastAdminRace = [];
    for (let trial = 0; trial < 3; trial++) {
      await User.updateMany({ _id: { $in: [adminA._id, adminB._id] } }, { status: 'ACTIVE' });
      const decisions = await Promise.all([
        call('patch', `/admin/users/${adminB.id}/status`, adminA).send({
          status: 'SUSPENDED',
          reason: 'Concurrent audit action A',
        }),
        call('patch', `/admin/users/${adminA.id}/status`, adminB).send({
          status: 'SUSPENDED',
          reason: 'Concurrent audit action B',
        }),
      ]);
      results.lastAdminRace.push({
        trial: trial + 1,
        statuses: decisions.map((response) => response.status),
        activeAdmins: await User.countDocuments({ role: 'ADMIN', status: 'ACTIVE' }),
      });
    }
    assert.equal(results.suspendedSocket.restSendHTTP, 403);
    assert.equal(results.suspendedSocket.socketStillConnected, false);
    assert.equal(results.suspendedSocket.socketSendAccepted, false);
    assert.equal(results.suspendedSocket.messagePersisted, false);
    assert.equal(results.suspendedSocket.receivesNewMessages, false);
    assert.equal(results.sharedRateBudget.nextPublicRequestHTTP, 200);
    assert.equal(results.sharedRateBudget.loginAfterReadBudgetHTTP, 401);
    for (const trial of results.lastAdminRace) {
      assert.equal(trial.activeAdmins, 1);
      assert.equal(trial.statuses.filter((status) => status === 200).length, 1);
    }
    await fs.mkdir(path.resolve('artifacts/system-audit'), { recursive: true });
    await fs.writeFile(
      path.resolve('artifacts/system-audit/local-probes.json'),
      JSON.stringify(results, null, 2),
    );
    console.log(JSON.stringify(results, null, 2));
  } finally {
    for (const client of clients) client.disconnect();
    await socket.closeSocket();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await delay(300);
    await mongoose.disconnect();
    await mongo.stop();
  }
};
run().catch((error) => {
  console.error('Local audit failed:', error);
  process.exitCode = 1;
});
