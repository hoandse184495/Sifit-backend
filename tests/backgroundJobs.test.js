const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const env = require('../src/config/env');
const BackgroundJob = require('../src/models/backgroundJob.model');
const User = require('../src/models/user.model');
const Category = require('../src/models/category.model');
const Product = require('../src/models/product.model');
const Order = require('../src/models/order.model');
const Group = require('../src/models/checkoutGroup.model');
const Payment = require('../src/models/payment.model');
const Notification = require('../src/models/notification.model');
const Outbox = require('../src/models/outboxEvent.model');
const jobs = require('../src/services/backgroundJob.service');
const reservations = require('../src/services/reservation.service');
const notifications = require('../src/services/notificationEvent.service');

let mongo, buyer, seller, category;
const fixture = async ({ paid = false, future = false } = {}) => {
  const expiry = new Date(Date.now() + (future ? 600000 : -60000));
  const product = await Product.create({
    sellerId: seller._id,
    categoryId: category._id,
    title: 'Worker test shirt',
    description: 'A reserved test garment',
    price: 100000,
    size: 'M',
    condition: 'GOOD',
    status: paid ? 'SOLD' : 'RESERVED',
  });
  const group = await Group.create({
    buyerId: buyer._id,
    idempotencyKey: crypto.randomUUID(),
    requestFingerprint: 'fixture',
    subtotal: 100000,
    buyerTotal: 100000,
    reservationExpiresAt: expiry,
    ...(paid ? { orderStatus: 'PAID', paymentStatus: 'PAID' } : {}),
  });
  const order = await Order.create({
    checkoutGroupId: group._id,
    buyerId: buyer._id,
    sellerId: seller._id,
    items: [{ productId: product._id, title: product.title, price: 100000, quantity: 1 }],
    shippingAddress: {
      recipientName: 'Fixture Buyer',
      phone: '0901234567',
      addressLine: 'Test street',
      ward: 'Ward',
      city: 'City',
    },
    subtotal: 100000,
    buyerTotal: 100000,
    commissionRateBasisPoints: 1000,
    commissionAmount: 10000,
    sellerProceeds: 90000,
    reservationExpiresAt: expiry,
    ...(paid ? { orderStatus: 'PAID', paymentStatus: 'PAID' } : {}),
  });
  const payment = await Payment.create({
    checkoutGroupId: group._id,
    buyerId: buyer._id,
    provider: 'simulator',
    providerPaymentId: crypto.randomUUID(),
    merchantReference: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    requestFingerprint: 'fixture',
    amount: 100000,
    status: paid ? 'SUCCEEDED' : 'PENDING',
    expiresAt: expiry,
  });
  return { product, group, order, payment };
};
const until = async (check) => {
  for (let i = 0; i < 200; i += 1) {
    if (await check()) return;
    await delay(25);
  }
  throw new Error('Background work did not finish');
};

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  jest.restoreAllMocks();
  env.BACKGROUND_JOBS_ENABLED = false;
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
  [buyer, seller] = await User.create(
    ['BUYER', 'SELLER'].map((role, index) => ({
      fullName: role,
      email: `worker-${index}@fixture.test`,
      role,
      passwordHash: 'fixture',
    })),
  );
  category = await Category.create({ name: 'Worker shirts', slug: 'worker-shirts' });
});
afterEach(() => {
  jest.restoreAllMocks();
  env.BACKGROUND_JOBS_ENABLED = false;
});

it('automatically cancels only expired unpaid orders, releases stock and delivers durable notifications once', async () => {
  const expired = await fixture();
  const paid = await fixture({ paid: true });
  const future = await fixture({ future: true });
  const scheduler = jobs.createScheduler(
    [
      { name: 'maintenance-test', intervalMs: 30, run: () => reservations.expireReservations() },
      { name: 'notifications-test', intervalMs: 30, run: () => notifications.processBatch() },
    ],
    { log: { info: () => {}, error: () => {} } },
  );
  try {
    await until(async () => (await Notification.countDocuments({ type: 'ORDER_CANCELLED' })) === 2);
    expect((await Group.findById(expired.group._id)).orderStatus).toBe('CANCELLED');
    expect((await Order.findById(expired.order._id)).cancellationReason).toBe(
      'reservation_expired',
    );
    expect((await Product.findById(expired.product._id)).status).toBe('ACTIVE');
    expect((await Payment.findById(expired.payment._id)).status).toBe('EXPIRED');
    expect((await Product.findById(paid.product._id)).status).toBe('SOLD');
    expect((await Order.findById(paid.order._id)).orderStatus).toBe('PAID');
    expect((await Product.findById(future.product._id)).status).toBe('RESERVED');
    expect((await Order.findById(future.order._id)).orderStatus).toBe('PENDING_PAYMENT');
    await reservations.expireReservations();
    await notifications.processBatch();
    expect(await Notification.countDocuments({ type: 'ORDER_CANCELLED' })).toBe(2);
    expect(await Outbox.countDocuments({ status: 'PROCESSED' })).toBe(2);
  } finally {
    await scheduler.stop();
  }
});

it('shares a durable lease across concurrent API instances and respects the next due time', async () => {
  let release;
  const action = jest.fn(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const definition = { name: 'shared', intervalMs: 60000, run: action };
  const first = jobs.runLeasedJob(definition);
  await until(() => action.mock.calls.length === 1);
  const second = await jobs.runLeasedJob(definition);
  expect(second.skipped).toBe(true);
  release({ processed: 2 });
  await first;
  expect((await jobs.runLeasedJob(definition)).skipped).toBe(true);
  const record = await BackgroundJob.findById('shared');
  expect(record.runCount).toBe(1);
  expect(record.lastResult.processed).toBe(2);
  expect(record.lastSucceededAt).toBeTruthy();
  expect(record.owner).toBeUndefined();
});

it('recovers an expired process lease and persists sanitized failures before retrying', async () => {
  await BackgroundJob.create({
    _id: 'recover',
    owner: 'dead-process',
    lockedUntil: new Date(Date.now() - 1000),
  });
  const run = jest
    .fn()
    .mockRejectedValueOnce(new Error('secret-token-and-private-payload'))
    .mockResolvedValueOnce({ processed: 1 });
  const definition = { name: 'recover', intervalMs: 0, run };
  await expect(jobs.runLeasedJob(definition)).rejects.toThrow('secret-token');
  const failed = await BackgroundJob.findById('recover');
  expect(failed.failureCount).toBe(1);
  expect(failed.lastError).toBe('Error');
  expect(JSON.stringify(failed)).not.toContain('secret-token');
  await jobs.runLeasedJob(definition);
  expect((await BackgroundJob.findById('recover')).lastError).toBeNull();
  expect(run).toHaveBeenCalledTimes(2);
});

it('rolls back inventory and cancellation when the durable notification write fails', async () => {
  const expired = await fixture();
  jest
    .spyOn(notifications, 'enqueueNotificationEvent')
    .mockRejectedValueOnce(new Error('Database write failure'));
  expect((await reservations.expireReservations()).failedCount).toBe(1);
  expect((await Group.findById(expired.group._id)).orderStatus).toBe('PENDING_PAYMENT');
  expect((await Product.findById(expired.product._id)).status).toBe('RESERVED');
  expect((await Payment.findById(expired.payment._id)).status).toBe('PENDING');
  expect(await Outbox.countDocuments()).toBe(0);
  await Group.updateOne({ _id: expired.group._id }, { $unset: { expiryLeaseExpiresAt: 1 } });
  expect((await reservations.expireReservations()).expiredCount).toBe(1);
});

it('keeps automatic jobs disabled in tests unless explicitly enabled', async () => {
  const scheduler = jobs.startBackgroundJobs();
  await scheduler.stop();
  expect(await BackgroundJob.countDocuments()).toBe(0);
});

it('does not let a PayOS failure block expiry of other unpaid orders in the batch', async () => {
  const blocked = await fixture();
  const healthy = await fixture();
  await Payment.updateOne({ _id: blocked.payment._id }, { provider: 'payos' });
  jest
    .spyOn(
      require('../src/services/paymentProviders/paymentProvider.factory'),
      'getPaymentProvider',
    )
    .mockReturnValue({
      queryPayment: async () => {
        throw new Error('Provider unavailable');
      },
    });
  const result = await reservations.expireReservations();
  expect(result.failedCount).toBe(1);
  expect(result.expiredCount).toBe(1);
  expect((await Product.findById(blocked.product._id)).status).toBe('RESERVED');
  expect((await Product.findById(healthy.product._id)).status).toBe('ACTIVE');
});

it('renews the lease while a long-running task is active', async () => {
  let release;
  const run = jest.fn(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const definition = { name: 'long-job', intervalMs: 0, leaseMs: 1000, run };
  const work = jobs.runLeasedJob(definition);
  try {
    await until(() => run.mock.calls.length === 1);
    const original = (await BackgroundJob.findById('long-job')).lockedUntil;
    await until(async () => (await BackgroundJob.findById('long-job')).lockedUntil > original);
    // Make a second process try after the original lease would have elapsed.
    const remaining = Math.max(0, original.getTime() - Date.now()) + 100;
    await delay(remaining);
    expect((await jobs.runLeasedJob(definition)).skipped).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  } finally {
    release({ processed: 1 });
    await work;
  }
});

const freePort = () =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });

it('starts jobs with real API processes, shares leases and shuts down without leaving active jobs', async () => {
  const expired = await fixture();
  await Outbox.create({
    eventKey: 'failed-before-restart',
    type: 'NOTIFICATION_CREATE',
    status: 'FAILED',
    attempts: 1,
    nextAttemptAt: new Date(Date.now() - 60000),
    payload: {
      recipientId: buyer._id,
      type: 'ORDER_CREATED',
      title: 'Earlier pending notification',
      body: 'Persisted before process startup',
      resourceType: 'ORDER',
      resourceId: expired.order._id,
      eventKey: 'failed-before-restart',
    },
  });
  const processes = [];
  try {
    for (let i = 0; i < 2; i += 1) {
      const port = await freePort();
      // IPC emits the same shutdown signal on Windows, where process.kill otherwise force-exits.
      const child = spawn(
        process.execPath,
        [
          '-e',
          "require('./src/server'); process.on('message', m => { if (m === 'shutdown') process.emit('SIGTERM'); });",
        ],
        {
          cwd: path.resolve(__dirname, '..'),
          env: {
            ...process.env,
            PORT: String(port),
            MONGODB_URI: mongo.getUri(),
            BACKGROUND_JOBS_ENABLED: 'true',
            BACKGROUND_MAINTENANCE_INTERVAL_SECONDS: '5',
            BACKGROUND_NOTIFICATION_INTERVAL_SECONDS: '5',
            PAYMENT_PROVIDER: 'simulator',
            PAYOS_CLIENT_ID: '',
            PAYOS_API_KEY: '',
            PAYOS_CHECKSUM_KEY: '',
          },
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        },
      );
      const state = { child, output: '', exited: false };
      child.stdout.on('data', (chunk) => {
        state.output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        state.output += chunk;
      });
      child.on('exit', (code) => {
        state.exited = true;
        state.code = code;
      });
      processes.push(state);
      await until(() => state.output.includes('SIFIT API listening'));
    }
    await until(async () =>
      Boolean((await BackgroundJob.findById('marketplace-maintenance'))?.lastFinishedAt),
    );
    expect((await BackgroundJob.findById('marketplace-maintenance')).runCount).toBe(1);
    await until(async () => (await Notification.countDocuments({ type: 'ORDER_CANCELLED' })) === 2);
    expect((await Order.findById(expired.order._id)).orderStatus).toBe('CANCELLED');
    expect(await Notification.countDocuments({ eventKey: 'failed-before-restart' })).toBe(1);
    expect(await BackgroundJob.countDocuments()).toBe(3);
    for (const state of processes) {
      state.child.send('shutdown');
      await until(() => state.exited);
      expect(state.code).toBe(0);
      expect(state.output).toContain('MongoDB connection closed');
    }
    expect(await BackgroundJob.countDocuments({ owner: { $exists: true } })).toBe(0);
  } finally {
    for (const state of processes) {
      if (!state.exited) state.child.kill();
    }
  }
});
