const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const User = require('../src/models/user.model');
const Product = require('../src/models/product.model');
const SellerProfile = require('../src/models/sellerProfile.model');
const Order = require('../src/models/order.model');
const { upgradeRoles } = require('../scripts/upgradeRoles');
let mongo;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await User.init();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await Promise.all([User, Product, SellerProfile, Order].map((model) => model.deleteMany({})));
});
const credentials = {
  fullName: 'Role Test',
  email: 'role@example.com',
  password: 'StrongPassword123!',
};
async function loginAs(role) {
  await request(app)
    .post('/api/v1/auth/register')
    .send({ ...credentials, role })
    .expect(201);
  return (await request(app).post('/api/v1/auth/login').send(credentials).expect(200)).body.data
    .accessToken;
}
it.each(['BUYER', 'SELLER'])('persists selected %s role across login and refresh', async (role) => {
  await request(app)
    .post('/api/v1/auth/register')
    .send({ ...credentials, role })
    .expect(201);
  const login = await request(app).post('/api/v1/auth/login').send(credentials).expect(200);
  expect(login.body.data.user.role).toBe(role);
  const refresh = await request(app)
    .post('/api/v1/auth/refresh-token')
    .set('Cookie', login.headers['set-cookie'][0].split(';')[0]);
  // Assert the route used by existing auth clients, including cookie rotation.
  expect(refresh.status).toBe(200);
  expect(refresh.body.data.user.role).toBe(role);
});
it.each(['ADMIN', 'USER', 'seller'])('rejects self-registration as %s', async (role) => {
  await request(app)
    .post('/api/v1/auth/register')
    .send({ ...credentials, role })
    .expect(400);
  expect(await User.countDocuments()).toBe(0);
});
it('buyer cannot call any seller area or product mutation', async () => {
  const token = await loginAs('BUYER');
  for (const url of [
    '/seller/profile',
    '/seller/orders',
    '/seller/earnings',
    '/seller/shipments',
    '/products/my',
  ]) {
    await request(app).get(`/api/v1${url}`).set('Authorization', `Bearer ${token}`).expect(403);
  }
  await request(app)
    .post('/api/v1/products')
    .set('Authorization', `Bearer ${token}`)
    .send({})
    .expect(403);
  await request(app)
    .get('/api/v1/admin/dashboard')
    .set('Authorization', `Bearer ${token}`)
    .expect(403);
});
it('seller cannot create purchases, carts, wishlists or buyer conversations', async () => {
  const token = await loginAs('SELLER');
  for (const url of ['/orders', '/cart/items', '/wishlist/items', '/conversations']) {
    await request(app)
      .post(`/api/v1${url}`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(403);
  }
});
it('an existing shipment is still protected against a different seller', async () => {
  const Shipment = require('../src/models/shipment.model');
  const shipping = require('../src/services/shipping.service');
  const orderId = new mongoose.Types.ObjectId();
  await Order.collection.insertOne({ _id: orderId, sellerId: new mongoose.Types.ObjectId() });
  await Shipment.collection.insertOne({ orderId, status: 'CREATED' });
  await expect(
    shipping.createShipment({ _id: new mongoose.Types.ObjectId() }, orderId, {}),
  ).rejects.toMatchObject({ statusCode: 403 });
});
it('migration uses shop, product and sale history, preserves admin and is idempotent', async () => {
  const records = ['shop', 'product', 'sale', 'buyer', 'admin'].map((name, i) => ({
    _id: new mongoose.Types.ObjectId(),
    fullName: name,
    email: `${i}@migration.test`,
    passwordHash: 'existing-hash',
    role: name === 'admin' ? 'ADMIN' : 'USER',
  }));
  await User.collection.insertMany(records);
  await SellerProfile.collection.insertOne({ userId: records[0]._id });
  await Product.collection.insertOne({ sellerId: records[1]._id });
  await Order.collection.insertOne({ sellerId: records[2]._id, buyerId: records[3]._id });
  expect(await upgradeRoles()).toMatchObject({ sellers: 3, buyers: 1, adminsUnchanged: 1 });
  expect(await User.countDocuments({ role: 'USER' })).toBe(4);
  expect(await upgradeRoles({ apply: true })).toMatchObject({
    sellersUpdated: 3,
    buyersUpdated: 1,
  });
  expect((await User.find().sort({ email: 1 })).map((user) => user.role)).toEqual([
    'SELLER',
    'SELLER',
    'SELLER',
    'BUYER',
    'ADMIN',
  ]);
  expect(await Order.countDocuments()).toBe(1);
  expect(await upgradeRoles({ apply: true })).toMatchObject({
    sellersUpdated: 0,
    buyersUpdated: 0,
  });
});
