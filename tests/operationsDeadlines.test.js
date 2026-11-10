const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const app = require('../src/app');
const User = require('../src/models/user.model');
const Order = require('../src/models/order.model');
const Dispute = require('../src/models/dispute.model');
const Outbox = require('../src/models/outboxEvent.model');
const Job = require('../src/models/backgroundJob.model');
const deadline = require('../src/services/deadline.service');
const { signAccessToken } = require('../src/utils/token');
let mongo, admin, seller, buyer, order;
beforeAll(async () => { mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(mongo.getUri()); await Promise.all(Object.values(mongoose.models).map(m => m.init())); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.models).map(m => m.deleteMany({})));
  [admin, seller, buyer] = await User.create(['ADMIN', 'SELLER', 'BUYER'].map((role, i) => ({ fullName: role, email: `${i}@deadline.test`, passwordHash: 'test', role })));
  order = await Order.create({ buyerId: buyer._id, sellerId: seller._id,
    items: [{ productId: new mongoose.Types.ObjectId(), title: 'Deadline jacket', price: 100000, quantity: 1 }],
    shippingAddress: { recipientName: 'Buyer', phone: '0901234567', addressLine: 'Street', ward: 'Ward', city: 'City' },
    subtotal: 100000, shippingFee: 0, buyerTotal: 100000, commissionRateBasisPoints: 1000, commissionAmount: 10000, sellerProceeds: 90000,
    paymentStatus: 'PAID', orderStatus: 'PAID', reservationExpiresAt: new Date(), sellerShipBy: new Date(Date.now() - 3600000) });
});
it('reminds and escalates once without cancelling a paid order and processes later batches', async () => {
  await deadline.run({ limit: 1 }); const count = await Outbox.countDocuments(); expect(count).toBe(3);
  await deadline.run({ limit: 1 }); expect(await Outbox.countDocuments()).toBe(count);
  expect((await Order.findById(order._id)).orderStatus).toBe('PAID');
  const second = order.toObject(); delete second._id; delete second.__v; await Order.create(second);
  await deadline.run({ limit: 1 }); expect(await Outbox.countDocuments()).toBe(6);
});
it('does not remind shipped orders, but escalates review/return deadlines without resolving a case', async () => {
  await Order.updateOne({ _id: order._id }, { orderStatus: 'SHIPPED' });
  const dispute = await Dispute.create({ orderId: order._id, buyerId: buyer._id, sellerId: seller._id, reason: 'OTHER', description: 'Review expired', reviewBy: new Date(Date.now() - 1000) });
  await deadline.run(); expect(await Outbox.countDocuments()).toBe(1);
  expect((await Dispute.findById(dispute._id)).status).toBe('OPEN');
  await deadline.run(); expect(await Outbox.countDocuments()).toBe(1);
});
it('restricts operations to admin and overdue orders to their own seller', async () => {
  const auth = user => ({ Authorization: `Bearer ${signAccessToken(user)}` });
  await request(app).get('/api/v1/admin/operations/health').set(auth(buyer)).expect(403);
  const own = await request(app).get('/api/v1/seller/overdue-orders').set(auth(seller)).expect(200);
  expect(own.body.data.items).toHaveLength(1);
  const other = await User.create({ fullName: 'Other', email: 'other@deadline.test', passwordHash: 'test', role: 'SELLER' });
  expect((await request(app).get('/api/v1/seller/overdue-orders').set(auth(other)).expect(200)).body.data.items).toHaveLength(0);
});
it('requeues failed or stale notifications but cannot steal active jobs or expose payloads', async () => {
  const auth = { Authorization: `Bearer ${signAccessToken(admin)}` };
  const item = await Outbox.create({ eventKey: 'failed', type: 'NOTIFICATION_CREATE', payload: { secret: 'private-data' }, status: 'FAILED', attempts: 5, lastError: 'old-private-error' });
  const list = await request(app).get('/api/v1/admin/operations/outbox').set(auth).expect(200);
  expect(JSON.stringify(list.body)).not.toMatch(/private-data|old-private-error/);
  await request(app).post(`/api/v1/admin/operations/outbox/${item._id}/retry`).set(auth).send({ reason: 'Provider restored' }).expect(200);
  expect((await Outbox.findById(item._id)).attempts).toBe(0);
  await Job.create({ _id: 'email-delivery', lockedUntil: new Date(Date.now() + 60000) });
  await request(app).post('/api/v1/admin/jobs/email-delivery/retry').set(auth).send({ reason: 'Operator requested' }).expect(409);
  await Job.updateOne({ _id: 'email-delivery' }, { lockedUntil: new Date(Date.now() - 1000) });
  await request(app).post('/api/v1/admin/jobs/email-delivery/retry').set(auth).send({ reason: 'Operator requested' }).expect(200);
});
