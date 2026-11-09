const crypto = require('node:crypto');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const app = require('../src/app');
const User = require('../src/models/user.model');
const Category = require('../src/models/category.model');
const Product = require('../src/models/product.model');
const Offer = require('../src/models/offer.model');
const Cart = require('../src/models/cart.model');
const Order = require('../src/models/order.model');
const Group = require('../src/models/checkoutGroup.model');
const Notification = require('../src/models/notification.model');
const Outbox = require('../src/models/outboxEvent.model');
const Shop = require('../src/models/sellerProfile.model');
const { signAccessToken } = require('../src/utils/token');
const events = require('../src/services/notificationEvent.service');
const service = require('../src/services/offer.service');
let mongo, buyer, buyer2, seller, seller2, category, product;
const api = (method, path, user = buyer) => {
  const client = request(app);
  return client[method](`/api/v1${path}`).set('Authorization', `Bearer ${signAccessToken(user)}`);
};
const makeProduct = (owner = seller, price = 100000) =>
  Product.create({
    sellerId: owner._id,
    categoryId: category._id,
    title: 'Vintage cotton shirt',
    description: 'Clean second hand garment',
    price,
    size: 'M',
    condition: 'GOOD',
    status: 'ACTIVE',
  });
const send = (user = buyer, target = product, amount = 80000, key = crypto.randomUUID()) =>
  api('post', `/products/${target.id}/offers`, user).send({
    amount,
    message: 'Mình đề nghị giá này nhé',
    idempotencyKey: key,
  });
const respond = (id, decision = 'ACCEPT', user = seller) =>
  api('post', `/seller/offers/${id}/respond`, user).send({ decision, note: 'Shop đã xem đề nghị' });
const accept = async (user = buyer, target = product, owner = seller) => {
  const response = await send(user, target).expect(201);
  const offer = response.body.data.offer;
  await respond(offer._id, 'ACCEPT', owner).expect(200);
  return offer;
};
const cart = (user = buyer, items = [product]) =>
  Cart.findOneAndUpdate(
    { userId: user._id },
    { $set: { items: items.map((item) => ({ productId: item._id })) } },
    { upsert: true, new: true },
  );
const shippingAddress = {
  recipientName: 'Buyer',
  phone: '0901234567',
  addressLine: '123 Test',
  ward: 'Ward',
  city: 'City',
};
const checkout = (offerIds = [], user = buyer, key = crypto.randomUUID()) =>
  api('post', '/orders', user).send({ shippingAddress, idempotencyKey: key, offerIds });
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
});
afterAll(async () => {
  jest.restoreAllMocks();
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  jest.restoreAllMocks();
  require('../src/middlewares/rateLimit.middleware').apiLimiter.resetKey('::ffff:127.0.0.1');
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
  [buyer, buyer2, seller, seller2] = await User.create(
    ['BUYER', 'BUYER', 'SELLER', 'SELLER'].map((role, index) => ({
      fullName: `Offer fixture ${index}`,
      email: `offer${index}@fixture.test`,
      passwordHash: 'fixture',
      role,
    })),
  );
  await Shop.create({ userId: seller._id, shopName: 'Offer shop', shopSlug: 'offer-shop' });
  category = await Category.create({ name: 'Áo', slug: 'ao' });
  product = await makeProduct();
});

it('validates login, role, integer prices and immutable submission fields', async () => {
  await request(app).post(`/api/v1/products/${product.id}/offers`).send({}).expect(401);
  await send(seller).expect(403);
  await send(buyer, product, 100000).expect(400);
  for (const amount of [0, -1, 10.5, '80000']) await send(buyer, product, amount).expect(400);
  await api('post', `/products/${product.id}/offers`)
    .send({ amount: 80000, idempotencyKey: crypto.randomUUID(), sellerId: seller2.id })
    .expect(400);
});

it('persists an idempotent private offer and seller notification without reserving inventory', async () => {
  const key = crypto.randomUUID();
  const responses = await Promise.all([
    send(buyer, product, 80000, key),
    send(buyer, product, 80000, key),
  ]);
  expect(responses.map((response) => response.status)).toEqual([201, 201]);
  const offer = responses[0].body.data.offer;
  expect(await Offer.countDocuments()).toBe(1);
  expect((await Product.findById(product.id)).status).toBe('ACTIVE');
  expect(
    await Notification.countDocuments({ recipientId: seller._id, type: 'OFFER_UPDATED' }),
  ).toBe(1);
  expect(offer.history.map((item) => item.action)).toEqual(['CREATED']);
  expect(JSON.stringify(offer)).not.toContain(buyer.email);
  await send(buyer, product, 70000, key).expect(409);
  await api('get', `/offers/${offer._id}`, buyer2).expect(404);
  await api('get', `/offers/${offer._id}`, seller2).expect(404);
});

it('limits open duplicates and repeated withdrawn submissions per product', async () => {
  for (let i = 0; i < 3; i += 1) {
    const response = await send().expect(201);
    await send().expect(409);
    await api('post', `/offers/${response.body.data.offer._id}/withdraw`).expect(200);
  }
  await send().expect(429);
  expect(await Offer.countDocuments()).toBe(3);
});

it('serializes the global submission quota across concurrent requests', async () => {
  await Offer.insertMany(
    Array.from({ length: 9 }, () => ({
      buyerId: buyer._id,
      sellerId: seller._id,
      productId: new mongoose.Types.ObjectId(),
      amount: 80000,
      listingPrice: 100000,
      idempotencyKey: crypto.randomUUID(),
      requestFingerprint: 'seed',
      status: 'WITHDRAWN',
      open: false,
      expiresAt: new Date(Date.now() + 100000),
    })),
  );
  const another = await makeProduct();
  const responses = await Promise.all([send(), send(buyer, another)]);
  expect(responses.map((response) => response.status).sort()).toEqual([201, 429]);
  expect(await Offer.countDocuments({ buyerId: buyer._id })).toBe(10);
});

it('allows only the owning seller to accept/reject once and keeps stock available after acceptance', async () => {
  const response = await send().expect(201);
  const id = response.body.data.offer._id;
  await respond(id, 'ACCEPT', seller2).expect(404);
  await respond(id, 'ACCEPT', buyer).expect(403);
  const accepted = await respond(id).expect(200);
  expect(accepted.body.data.offer.status).toBe('ACCEPTED');
  expect((await Product.findById(product.id)).status).toBe('ACTIVE');
  await respond(id, 'REJECT').expect(409);
  expect(await Notification.countDocuments({ recipientId: buyer._id, type: 'OFFER_UPDATED' })).toBe(
    1,
  );
});

it('saves rejection notes, withdrawal and a history even after the product disappears', async () => {
  const first = (await send().expect(201)).body.data.offer;
  await respond(first._id, 'REJECT').expect(200);
  const second = await accept();
  await api('post', `/offers/${second._id}/withdraw`).expect(200);
  await Product.deleteOne({ _id: product._id });
  const response = await api('get', '/offers/my').expect(200);
  expect(response.body.data.items).toHaveLength(2);
  expect(response.body.data.items.find((item) => item._id === first._id).responseNote).toBe(
    'Shop đã xem đề nghị',
  );
  expect(response.body.data.items.every((item) => !item.actionable)).toBe(true);
});

it('rejects pending, expired and unavailable offers and expires them with durable notifications once', async () => {
  const offer = (await send().expect(201)).body.data.offer;
  await cart();
  await checkout([offer._id]).expect(409);
  await Offer.updateOne({ _id: offer._id }, { expiresAt: new Date(Date.now() - 1000) });
  const list = await api('get', '/offers/my?status=EXPIRED').expect(200);
  expect(list.body.data.items[0].effectiveStatus).toBe('EXPIRED');
  await respond(offer._id).expect(409);
  const runs = await Promise.all([service.expireOffers(), service.expireOffers()]);
  expect(runs.reduce((sum, result) => sum + result.expiredCount, 0)).toBe(1);
  expect(await Outbox.countDocuments({ eventKey: { $regex: ':EXPIRED:' } })).toBe(2);
  expect((await Product.findById(product.id)).status).toBe('ACTIVE');
});

it('uses the accepted amount for item snapshots, commissions, mixed-seller totals and payment QR amounts', async () => {
  const offer = await accept();
  const fullPrice = await makeProduct(seller2, 200000);
  await cart(buyer, [product, fullPrice]);
  const key = crypto.randomUUID();
  const response = await checkout([offer._id], buyer, key).expect(201);
  const group = response.body.data.checkout;
  expect(group.subtotal).toBe(280000);
  expect(group.orders).toHaveLength(2);
  const negotiated = group.orders.find((item) => String(item.sellerId._id) === seller.id);
  expect(negotiated.items[0]).toMatchObject({
    price: 80000,
    listingPrice: 100000,
    offerId: offer._id,
  });
  expect(negotiated.commissionAmount).toBe(8000);
  expect(negotiated.sellerProceeds).toBe(72000);
  expect((await Offer.findById(offer._id)).status).toBe('CHECKED_OUT');
  expect((await Product.findById(product.id)).price).toBe(100000);
  expect((await checkout([offer._id], buyer, key).expect(201)).body.data.checkout.id).toBe(
    group.id,
  );
  await checkout([], buyer, key).expect(409);
  const payment = await api('post', '/payments')
    .send({ checkoutGroupId: group.id, idempotencyKey: crypto.randomUUID() })
    .expect(201);
  expect(payment.body.data.payment.amount).toBe(280000);
});

it('rejects another buyer’s offer and an offer outside the cart without changing inventory', async () => {
  const offer = await accept();
  await cart(buyer2);
  await checkout([offer._id], buyer2).expect(409);
  const other = await makeProduct();
  await cart(buyer, [other]);
  await checkout([offer._id]).expect(409);
  expect((await Product.findById(product.id)).status).toBe('ACTIVE');
  expect(await Group.countDocuments()).toBe(0);
});

it('refuses stale accepted prices, suspended shops and duplicate offer IDs', async () => {
  const offer = await accept();
  await cart();
  await checkout([offer._id, offer._id]).expect(400);
  await Product.updateOne({ _id: product.id }, { price: 90000 });
  await checkout([offer._id]).expect(409);
  await Product.updateOne({ _id: product.id }, { price: 100000 });
  await Shop.updateOne({ userId: seller.id }, { status: 'SUSPENDED' });
  await checkout([offer._id]).expect(409);
  expect(await Group.countDocuments()).toBe(0);
});

it('lets just one of two accepted buyers reserve the unique item', async () => {
  const first = await accept();
  const second = await accept(buyer2);
  await cart();
  await cart(buyer2);
  const responses = await Promise.all([checkout([first._id]), checkout([second._id], buyer2)]);
  expect(responses.map((item) => item.status).sort()).toEqual([201, 409]);
  expect(await Offer.countDocuments({ status: 'CHECKED_OUT' })).toBe(1);
  expect(await Group.countDocuments()).toBe(1);
});

it('never reuses a consumed offer after cancellation releases the product', async () => {
  const offer = await accept();
  await cart();
  const response = await checkout([offer._id]).expect(201);
  const order = response.body.data.checkout.orders[0];
  await api('post', `/orders/${order._id}/cancel`).send({}).expect(200);
  expect((await Product.findById(product.id)).status).toBe('ACTIVE');
  await cart();
  await checkout([offer._id]).expect(409);
});

it('rolls back offer consumption, stock and checkout when a notification write fails', async () => {
  const offer = await accept();
  await cart();
  jest
    .spyOn(events, 'enqueueNotificationEvent')
    .mockRejectedValueOnce(new Error('Outbox unavailable'));
  await checkout([offer._id]).expect(500);
  expect(await Group.countDocuments()).toBe(0);
  expect(await Order.countDocuments()).toBe(0);
  expect((await Product.findById(product.id)).status).toBe('ACTIVE');
  expect((await Offer.findById(offer._id)).status).toBe('ACCEPTED');
  expect((await Cart.findOne({ userId: buyer.id })).items).toHaveLength(1);
});
