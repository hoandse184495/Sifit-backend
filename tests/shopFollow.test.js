// Control scheduling only: API, transactions, fan-out and notification delivery stay real.
jest.mock('../src/utils/flushNotifications', () => jest.fn(async () => {}));
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const app = require('../src/app');
const User = require('../src/models/user.model');
const Shop = require('../src/models/sellerProfile.model');
const Product = require('../src/models/product.model');
const Category = require('../src/models/category.model');
const Follow = require('../src/models/shopFollow.model');
const Notification = require('../src/models/notification.model');
const Preference = require('../src/models/notificationPreference.model');
const Outbox = require('../src/models/outboxEvent.model');
const audit = require('../src/services/adminAudit.service');
const events = require('../src/services/notificationEvent.service');
const { signAccessToken } = require('../src/utils/token');
let mongo, buyer, other, seller, seller2, admin, shop, shop2, category;
const api = (method, path, user = buyer) => {
  const client = request(app);
  return client[method](`/api/v1${path}`).set('Authorization', `Bearer ${signAccessToken(user)}`);
};
const follow = (target = shop, user = buyer, body = {}) =>
  api('put', `/shops/${target.id}/follow`, user).send(body);
const unfollow = (target = shop) => api('delete', `/shops/${target.id}/follow`);
const product = (owner = seller, status = 'PENDING', title = 'Áo cotton mới duyệt') =>
  Product.create({
    sellerId: owner._id,
    categoryId: category._id,
    title,
    description: 'A pre-loved garment',
    price: 120000,
    size: 'M',
    condition: 'GOOD',
    status,
  });
const approve = (item) => api('patch', `/admin/products/${item.id}/approve`, admin).send({});
const deliver = async () => {
  await events.processBatch({ limit: 100 });
  await events.processBatch({ limit: 100 });
};
const notifications = () => Notification.find({ type: 'FOLLOWED_SHOP_NEW_PRODUCT' });
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
  require('../src/middlewares/rateLimit.middleware').apiLimiter.resetKey('::ffff:127.0.0.1');
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
  [buyer, other, seller, seller2, admin] = await User.create(
    ['BUYER', 'BUYER', 'SELLER', 'SELLER', 'ADMIN'].map((role, index) => ({
      fullName: `Follow ${index}`,
      email: `follow${index}@test.com`,
      role,
      passwordHash: 'fixture',
    })),
  );
  [shop, shop2] = await Shop.create([
    {
      userId: seller._id,
      shopName: 'Sifit Linen',
      shopSlug: 'sifit-linen',
      contactPhone: 'private-phone',
    },
    { userId: seller2._id, shopName: 'Vintage Studio', shopSlug: 'vintage-studio' },
  ]);
  category = await Category.create({ name: 'Áo', slug: 'ao' });
});
it('requires a buyer login and strict ownership/validation; private follow lists never leak', async () => {
  await request(app).put(`/api/v1/shops/${shop.id}/follow`).send({}).expect(401);
  for (const user of [seller, admin]) {
    await follow(shop, user).expect(403);
    await api('get', '/shop-follows/my', user).expect(403);
  }
  await follow(shop, buyer, { buyerId: other.id }).expect(400);
  await follow(shop, buyer, { notifyNewProducts: 'true' }).expect(400);
  await api('put', '/shops/bad/follow').send({}).expect(400);
  await follow().expect(200);
  expect((await api('get', '/shop-follows/my', other).expect(200)).body.data.pagination.total).toBe(
    0,
  );
  const own = (await api('get', '/shop-follows/my').expect(200)).body.data;
  expect(JSON.stringify(own)).not.toContain('private-phone');
  expect(JSON.stringify(own)).not.toContain('passwordHash');
});
it('serializes concurrent follow, makes retry/unfollow idempotent and returns a correct count', async () => {
  const responses = await Promise.all(Array.from({ length: 5 }, () => follow()));
  expect(responses.every((response) => response.status === 200)).toBe(true);
  expect(await Follow.countDocuments()).toBe(1);
  const initial = await Follow.findOne();
  await follow().expect(200);
  expect((await Follow.findOne()).followedAt.getTime()).toBe(initial.followedAt.getTime());
  expect(
    (await request(app).get(`/api/v1/shops/${shop.id}/followers/count`)).body.data.followerCount,
  ).toBe(1);
  await unfollow().expect(200);
  await unfollow().expect(200);
  expect((await api('get', `/shops/${shop.id}/follow`)).body.data.following).toBe(false);
  await follow().expect(200);
  expect(await Follow.countDocuments()).toBe(1);
  expect((await Follow.findOne()).following).toBe(true);
});
it('rejects inactive/missing shops and suspended accounts; still lets users remove unavailable shops', async () => {
  await follow().expect(200);
  await Shop.updateOne({ _id: shop._id }, { status: 'SUSPENDED' });
  await follow().expect(404);
  const list = (await api('get', '/shop-follows/my')).body.data;
  expect(list.items[0].available).toBe(false);
  await unfollow().expect(200);
  await follow({ id: new mongoose.Types.ObjectId().toString() }).expect(404);
  await User.updateOne({ _id: seller2._id }, { status: 'SUSPENDED' });
  await follow(shop2).expect(404);
  await User.updateOne({ _id: buyer._id }, { status: 'SUSPENDED' });
  await follow().expect(403);
});
it('keeps a deleted shop reference so unfollow still works and paginates followed shops', async () => {
  await follow().expect(200);
  await follow(shop2).expect(200);
  const list = await api('get', '/shop-follows/my?limit=1&page=2').expect(200);
  expect(list.body.data.items).toHaveLength(1);
  expect(list.body.data.pagination.total).toBe(2);
  await Shop.deleteOne({ _id: shop._id });
  const deleted = (await api('get', '/shop-follows/my')).body.data.items.find(
    (item) => String(item.shopId) === shop.id,
  );
  expect(deleted.available).toBe(false);
  await api('delete', `/shops/${deleted.shopId}/follow`).expect(200);
});
it('feeds only available products from followed, active shops; paginates without private fields', async () => {
  await follow().expect(200);
  await product(seller, 'ACTIVE', 'Available shirt one');
  await product(seller, 'ACTIVE', 'Available shirt two');
  await product(seller, 'PENDING');
  await product(seller, 'SOLD');
  await product(seller, 'ARCHIVED');
  await product(seller2, 'ACTIVE', 'Unfollowed shirt');
  const deleted = await product(seller, 'ACTIVE', 'Deleted product');
  await Product.updateOne({ _id: deleted._id }, { deletedAt: new Date() });
  const result = (await api('get', '/shop-follows/products?limit=1&page=2').expect(200)).body.data;
  expect(result.pagination.total).toBe(2);
  expect(result.items).toHaveLength(1);
  expect(result.items[0].shop.shopName).toBe(shop.shopName);
  expect(result.items[0].sellerId.fullName).toBe(seller.fullName);
  expect(JSON.stringify(result)).not.toContain('private-phone');
  await User.updateOne({ _id: seller._id }, { status: 'SUSPENDED' });
  expect((await api('get', '/shop-follows/products')).body.data.pagination.total).toBe(0);
});
it('creates no announcement for drafts, pending/rejected products or historical approvals', async () => {
  await follow().expect(200);
  await product(seller, 'DRAFT');
  const pending = await product();
  await deliver();
  expect(await notifications()).toHaveLength(0);
  await api('patch', `/admin/products/${pending.id}/reject`, admin)
    .send({ reason: 'Needs better images' })
    .expect(200);
  await deliver();
  expect(await notifications()).toHaveLength(0);
  const already = await product(seller, 'ACTIVE');
  await Product.updateOne({ _id: already._id }, { approvedAt: new Date(Date.now() - 10000) });
  await deliver();
  expect(await notifications()).toHaveLength(0);
});
it('announces an approved product exactly once to eligible followers, even after worker retry or reapproval', async () => {
  await follow().expect(200);
  await follow(shop, other).expect(200);
  const item = await product();
  await approve(item).expect(200);
  await approve(item).expect(409);
  await deliver();
  expect(await notifications()).toHaveLength(2);
  const job = await Outbox.findOne({ type: 'SHOP_PRODUCT_APPROVED' });
  await events.processEvent(job);
  await deliver();
  expect(await notifications()).toHaveLength(2);
  await Product.updateOne({ _id: item._id }, { status: 'PENDING', $unset: { approvedAt: 1 } });
  await approve(item).expect(200);
  await deliver();
  expect(await notifications()).toHaveLength(2);
});
it('respects both per-shop and global opt-outs without unfollowing', async () => {
  await follow(shop, buyer, { notifyNewProducts: false }).expect(200);
  await follow(shop, other).expect(200);
  await api('patch', '/notifications/preferences', other)
    .send({ followedShopNotifications: false })
    .expect(200);
  const item = await product();
  await approve(item).expect(200);
  await deliver();
  expect(await notifications()).toHaveLength(0);
  expect(await Follow.countDocuments({ following: true })).toBe(2);
  await api('patch', `/shops/${shop.id}/follow`).send({ notifyNewProducts: true }).expect(200);
  await api('patch', '/notifications/preferences', other)
    .send({ followedShopNotifications: true })
    .expect(200);
  const second = await product();
  await approve(second).expect(200);
  await deliver();
  expect(await notifications()).toHaveLength(2);
  expect((await Preference.findOne({ userId: other._id })).orderNotifications).toBe(true);
});
it('rechecks unfollow, preference and availability at delivery after a queued fan-out', async () => {
  await follow().expect(200);
  const item = await product();
  await approve(item).expect(200);
  await events.processBatch(); // expands the job; does not deliver its newly queued children yet
  await unfollow().expect(200);
  await deliver();
  expect(await notifications()).toHaveLength(0);
  await follow().expect(200);
  const next = await product();
  await approve(next).expect(200);
  await events.processBatch();
  await api('patch', `/shops/${shop.id}/follow`).send({ notifyNewProducts: false }).expect(200);
  await deliver();
  expect(await notifications()).toHaveLength(0);
  await api('patch', `/shops/${shop.id}/follow`).send({ notifyNewProducts: true }).expect(200);
  const hidden = await product();
  await approve(hidden).expect(200);
  await events.processBatch();
  await Product.updateOne({ _id: hidden._id }, { status: 'ARCHIVED' });
  await deliver();
  expect(await notifications()).toHaveLength(0);
});
it('does not notify a new or refollowing buyer about an older approval', async () => {
  const item = await product();
  await approve(item).expect(200);
  await follow().expect(200);
  await deliver();
  expect(await notifications()).toHaveLength(0);
  await unfollow().expect(200);
  const next = await product();
  await approve(next).expect(200);
  await follow().expect(200);
  await deliver();
  expect(await notifications()).toHaveLength(0);
});
it('rolls back product approval and announcement if audit fails, then retries safely', async () => {
  await follow().expect(200);
  const item = await product();
  const spy = jest.spyOn(audit, 'record').mockRejectedValueOnce(new Error('Audit unavailable'));
  await approve(item).expect(500);
  spy.mockRestore();
  expect((await Product.findById(item._id)).status).toBe('PENDING');
  expect(await Outbox.countDocuments()).toBe(0);
  await approve(item).expect(200);
  await deliver();
  expect(await notifications()).toHaveLength(1);
});
it('disallows changing another user or creating a follow via notification preferences', async () => {
  await api('patch', `/shops/${shop.id}/follow`).send({ notifyNewProducts: true }).expect(409);
  await follow().expect(200);
  await api('patch', `/shops/${shop.id}/follow`)
    .send({ notifyNewProducts: false, buyerId: other.id })
    .expect(400);
  const item = await product();
  await approve(item).expect(200);
  await User.updateOne({ _id: buyer._id }, { status: 'SUSPENDED' });
  await deliver();
  expect(await notifications()).toHaveLength(0);
});
it('recovers stale worker leases and does not redeliver notifications across concurrent workers', async () => {
  await follow().expect(200);
  const item = await product();
  await approve(item).expect(200);
  const job = await Outbox.findOne({ type: 'SHOP_PRODUCT_APPROVED' });
  await Outbox.updateOne(
    { _id: job._id },
    { status: 'PROCESSING', lockedAt: new Date(Date.now() - 6 * 60000), attempts: 1 },
  );
  await Promise.all([events.processBatch(), events.processBatch()]);
  await Promise.all([events.processBatch(), events.processBatch()]);
  expect((await Outbox.findById(job._id)).status).toBe('PROCESSED');
  expect(await notifications()).toHaveLength(1);
});
