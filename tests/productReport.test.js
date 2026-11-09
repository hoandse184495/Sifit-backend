const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const app = require('../src/app');
const User = require('../src/models/user.model');
const Product = require('../src/models/product.model');
const Category = require('../src/models/category.model');
const Report = require('../src/models/productReport.model');
const Audit = require('../src/models/adminAuditLog.model');
const Notification = require('../src/models/notification.model');
const Outbox = require('../src/models/outboxEvent.model');
const Preference = require('../src/models/notificationPreference.model');
const auditService = require('../src/services/adminAudit.service');
const notificationEvents = require('../src/services/notificationEvent.service');
const { signAccessToken } = require('../src/utils/token');

let mongo, buyer, otherBuyer, seller, admin, products;
const body = {
  reason: 'MISLEADING',
  description: 'Ảnh sản phẩm không khớp với thông tin được mô tả.',
};
const note = 'Đã kiểm tra ảnh và nội dung sản phẩm theo quy định của sàn.';
const auth = (user) => `Bearer ${signAccessToken(user)}`;
const submit = (user = buyer, product = products[0], data = body) =>
  request(app)
    .post(`/api/v1/products/${product.id}/reports`)
    .set('Authorization', auth(user))
    .send(data);
const resolve = (id, decision = 'KEEP', user = admin) =>
  request(app)
    .patch(`/api/v1/admin/product-reports/${id}/resolve`)
    .set('Authorization', auth(user))
    .send({ decision, note });
const policy = (id, action, extra = {}) =>
  request(app)
    .patch(`/api/v1/admin/product-reports/${id}/reporter`)
    .set('Authorization', auth(admin))
    .send({ action, note, ...extra });

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}, 60000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  jest.restoreAllMocks();
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
  [buyer, otherBuyer, seller, admin] = await User.create(
    ['BUYER', 'BUYER', 'SELLER', 'ADMIN'].map((role, index) => ({
      fullName: `Report User ${index}`,
      email: `report${index}@test.com`,
      role,
      passwordHash: 'not-a-real-login-hash',
    })),
  );
  const category = await Category.create({ name: 'Áo', slug: 'ao' });
  products = await Product.create(
    Array.from({ length: 15 }, (_, index) => ({
      sellerId: seller._id,
      categoryId: category._id,
      title: `Report product ${index}`,
      description: 'Original product description',
      price: 120000,
      size: 'M',
      condition: 'GOOD',
      status: 'ACTIVE',
      images: [{ url: 'https://example.test/item.jpg', publicId: `fixture/${index}` }],
    })),
  );
});

it('requires login, validates reason/description/ids, rejects forged fields and own products', async () => {
  await request(app).post(`/api/v1/products/${products[0].id}/reports`).send(body).expect(401);
  await submit(seller).expect(403);
  await submit(admin).expect(403);
  for (const data of [
    { ...body, reason: 'FAKE' },
    { ...body, description: '   ' },
    { ...body, description: 'a'.repeat(1001) },
    { ...body, reporterId: otherBuyer.id },
    { ...body, status: 'RESOLVED' },
  ])
    await submit(buyer, products[0], data).expect(400);
  await request(app)
    .post('/api/v1/products/bad-id/reports')
    .set('Authorization', auth(buyer))
    .send(body)
    .expect(400);
  await User.updateOne({ _id: buyer._id }, { status: 'SUSPENDED' });
  await submit().expect(403);
  expect(await Report.countDocuments()).toBe(0);
});

it('stores a trusted snapshot, keeps product visible, isolates history and admin data', async () => {
  const response = await submit().expect(201);
  expect(response.body.data.report.productSnapshot.title).toBe(products[0].title);
  expect(response.body.data.report.productSnapshot.images[0].publicId).toBeUndefined();
  await Product.updateOne({ _id: products[0]._id }, { title: 'Changed product name' });
  const own = await request(app)
    .get(`/api/v1/product-reports/my?productId=${products[0].id}`)
    .set('Authorization', auth(buyer))
    .expect(200);
  expect(own.body.data.items[0].productSnapshot.title).toBe(products[0].title);
  const other = await request(app)
    .get('/api/v1/product-reports/my')
    .set('Authorization', auth(otherBuyer))
    .expect(200);
  expect(other.body.data.pagination.total).toBe(0);
  for (const user of [buyer, seller])
    await request(app)
      .get('/api/v1/admin/product-reports')
      .set('Authorization', auth(user))
      .expect(403);
  await request(app).get(`/api/v1/products/${products[0].id}`).expect(200);
});

it('deduplicates concurrent reports atomically and keeps limits unchanged for duplicates', async () => {
  const responses = await Promise.all(Array.from({ length: 6 }, () => submit()));
  expect(responses.map((response) => response.status).sort()).toEqual([
    201, 409, 409, 409, 409, 409,
  ]);
  expect(await Report.countDocuments()).toBe(1);
  await submit(buyer, products[1]).expect(201);
  await submit(buyer, products[2]).expect(201);
  await submit(buyer, products[3]).expect(429);
});

it('enforces the per-account 10-minute quota for concurrent requests across products', async () => {
  const responses = await Promise.all(
    products.slice(0, 7).map((product) => submit(buyer, product)),
  );
  expect(responses.filter((response) => response.status === 201)).toHaveLength(3);
  expect(responses.filter((response) => response.status === 429)).toHaveLength(4);
  expect(await Report.countDocuments({ reporterId: buyer._id })).toBe(3);
  await submit(otherBuyer, products[7]).expect(201);
  const record = await Report.findOne({ reporterId: buyer._id });
  await resolve(record.id).expect(200);
  await submit(buyer, products[8]).expect(429);
});

it('enforces rolling 24-hour quota including resolved reports and expires old entries', async () => {
  await Report.insertMany(
    products
      .slice(0, 10)
      .map((product) => ({
        reporterId: buyer._id,
        sellerId: seller._id,
        productId: product._id,
        ...body,
        productSnapshot: { title: product.title },
        status: 'RESOLVED',
        decision: 'KEEP',
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      })),
  );
  const blocked = await submit(buyer, products[10]).expect(429);
  expect(blocked.body.message).toContain('24 giờ');
  await Report.collection.updateMany(
    {},
    { $set: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } },
  );
  await submit(buyer, products[10]).expect(201);
});

it('many different users reporting never automatically hide a listing', async () => {
  const users = await User.create(
    Array.from({ length: 4 }, (_, index) => ({
      fullName: `Extra Buyer ${index}`,
      email: `extra${index}@test.com`,
      passwordHash: 'unused',
    })),
  );
  for (const user of users) await submit(user).expect(201);
  expect((await Product.findById(products[0]._id)).status).toBe('ACTIVE');
  await request(app).get(`/api/v1/products/${products[0].id}`).expect(200);
});

it('admin filters/paginates and KEEP resolves once without changing the product', async () => {
  const created = (await submit().expect(201)).body.data.report;
  await submit(otherBuyer, products[1], { ...body, reason: 'COUNTERFEIT' }).expect(201);
  const listed = await request(app)
    .get('/api/v1/admin/product-reports?status=OPEN&reason=MISLEADING&limit=1')
    .set('Authorization', auth(admin))
    .expect(200);
  expect(listed.body.data.items).toHaveLength(1);
  expect(listed.body.data.items[0].reporterId.fullName).toBe(buyer.fullName);
  expect(JSON.stringify(listed.body.data)).not.toContain('passwordHash');
  await resolve(created._id).expect(200);
  await resolve(created._id, 'HIDE').expect(409);
  expect((await Product.findById(products[0]._id)).status).toBe('ACTIVE');
  expect(await Audit.countDocuments({ action: 'PRODUCT_REPORT_RESOLVED' })).toBe(1);
  expect(
    await Notification.countDocuments({ recipientId: buyer._id, type: 'PRODUCT_REPORT_RESOLVED' }),
  ).toBe(1);
  expect(await Notification.countDocuments({ recipientId: seller._id })).toBe(0);
  await submit().expect(201);
});

it('HIDE atomically archives, audits and notifies seller/reporter even when notifications disabled', async () => {
  const created = (await submit().expect(201)).body.data.report;
  await Preference.create({ userId: seller._id, inAppEnabled: false, productNotifications: false });
  const responses = await Promise.all([resolve(created._id, 'HIDE'), resolve(created._id, 'HIDE')]);
  expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  const product = await Product.findById(products[0]._id);
  expect(product.status).toBe('ARCHIVED');
  expect(String(product.hiddenBy)).toBe(admin.id);
  expect(product.rejectionReason).toBe(note);
  await request(app).get(`/api/v1/products/${product.id}`).expect(404);
  expect(
    await Notification.countDocuments({ recipientId: seller._id, type: 'PRODUCT_HIDDEN' }),
  ).toBe(1);
  const log = await Audit.findOne({ action: 'PRODUCT_REPORT_RESOLVED' });
  expect(log.after.productId).toBe(product.id);
  expect(await Outbox.countDocuments({ status: 'PROCESSED' })).toBe(2);
  await notificationEvents.processBatch();
  expect(await Notification.countDocuments()).toBe(2);
});

it.each(['RESERVED', 'SOLD', 'ARCHIVED'])(
  'never hides %s products; KEEP preserves existing state',
  async (status) => {
    const created = (await submit().expect(201)).body.data.report;
    await Product.updateOne({ _id: products[0]._id }, { status });
    await resolve(created._id, 'HIDE').expect(409);
    expect((await Report.findById(created._id)).status).toBe('OPEN');
    expect(await Audit.countDocuments()).toBe(0);
    await resolve(created._id, 'KEEP').expect(200);
    expect((await Product.findById(products[0]._id)).status).toBe(status);
  },
);

it('rolls back product/report changes if audit persistence fails; retry succeeds', async () => {
  const created = (await submit().expect(201)).body.data.report;
  const spy = jest
    .spyOn(auditService, 'record')
    .mockRejectedValueOnce(new Error('Simulated audit outage'));
  await resolve(created._id, 'HIDE').expect(500);
  spy.mockRestore();
  expect((await Product.findById(products[0]._id)).status).toBe('ACTIVE');
  expect((await Report.findById(created._id)).status).toBe('OPEN');
  expect(await Outbox.countDocuments()).toBe(0);
  await resolve(created._id, 'HIDE').expect(200);
});

it('successful resolution survives notification delivery failure and leaves a retryable outbox', async () => {
  const created = (await submit().expect(201)).body.data.report;
  const spy = jest
    .spyOn(notificationEvents, 'processBatch')
    .mockRejectedValueOnce(new Error('Offline delivery'));
  await resolve(created._id, 'HIDE').expect(200);
  spy.mockRestore();
  expect(await Outbox.countDocuments({ status: 'PENDING' })).toBe(2);
  await notificationEvents.processBatch();
  expect(await Notification.countDocuments()).toBe(2);
});

it('warn/block/unblock has audited history; block only restricts reporting and expires automatically', async () => {
  const created = (await submit().expect(201)).body.data.report;
  await policy(created._id, 'WARN').expect(200);
  await policy(created._id, 'BLOCK', { days: 7 }).expect(200);
  await submit(buyer, products[1]).expect(403);
  await request(app).get('/api/v1/auth/me').set('Authorization', auth(buyer)).expect(200);
  const list = await request(app)
    .get('/api/v1/admin/product-reports')
    .set('Authorization', auth(admin))
    .expect(200);
  expect(list.body.data.items[0].reporterId.reportingWarning).toBe(note);
  expect(list.body.data.items[0].reporterId.reportingBlockedUntil).toBeTruthy();
  await policy(created._id, 'UNBLOCK').expect(200);
  await submit(buyer, products[1]).expect(201);
  await User.updateOne({ _id: buyer._id }, { reportingBlockedUntil: new Date(Date.now() - 1000) });
  await submit(buyer, products[2]).expect(201);
  expect(await Audit.countDocuments({ action: /^PRODUCT_REPORTER_/ })).toBe(3);
  expect(
    await Notification.countDocuments({ recipientId: buyer._id, type: 'REPORTING_POLICY' }),
  ).toBe(3);
});

it('rejects invalid moderation, unauthorized actions and moderator conflicts of interest', async () => {
  const created = (await submit().expect(201)).body.data.report;
  await resolve(created._id, 'HIDE', buyer).expect(403);
  await request(app)
    .patch(`/api/v1/admin/product-reports/${created._id}/resolve`)
    .set('Authorization', auth(admin))
    .send({ decision: 'HIDE', note: 'bad' })
    .expect(400);
  await policy(created._id, 'BLOCK').expect(400);
  await policy(created._id, 'BLOCK', { days: 31 }).expect(400);
  await User.updateOne({ _id: buyer._id }, { role: 'ADMIN' });
  await resolve(created._id, 'KEEP', buyer).expect(403);
  await policy(created._id, 'BLOCK', { days: 1 }).expect(409);
});

