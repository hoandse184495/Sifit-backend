const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const app = require('../src/app');
const orderStatus = require('../src/constants/orderStatus');
const paymentStatus = require('../src/constants/paymentStatus');
const roles = require('../src/constants/roles');
const Cart = require('../src/models/cart.model');
const Category = require('../src/models/category.model');
const CheckoutGroup = require('../src/models/checkoutGroup.model');
const Order = require('../src/models/order.model');
const Product = require('../src/models/product.model');
const User = require('../src/models/user.model');
const { expireReservations } = require('../src/services/reservation.service');

let replSet;
let category;

const shippingAddress = {
  recipientName: 'Nguyen Van A',
  phone: '0901234567',
  addressLine: '123 Nguyen Trai',
  ward: 'Ben Thanh',
  district: 'District 1',
  city: 'Ho Chi Minh City',
};

const productPayload = (sellerId, overrides = {}) => ({
  sellerId,
  title: overrides.title || 'Vintage denim jacket',
  description: 'A clean second-hand item.',
  price: overrides.price || 250000,
  categoryId: category._id,
  brand: 'Levis',
  size: 'M',
  color: 'Blue',
  condition: 'GOOD',
  status: overrides.status || 'ACTIVE',
  images: [{ url: 'https://example.com/image.png', publicId: 'sifit/products/image' }],
  ...overrides,
});

const registerAndLogin = async (email, role = roles.BUYER) => {
  const password = 'StrongPassword123!';

  await request(app)
    .post('/api/v1/auth/register')
    .send({ fullName: email.split('@')[0], email, password })
    .expect(201);

  if (role !== roles.BUYER) {
    await User.updateOne({ email }, { role });
  }

  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  const user = await User.findOne({ email });

  return {
    accessToken: response.body.data.accessToken,
    user,
  };
};

const addToCart = (accessToken, productId) =>
  request(app)
    .post('/api/v1/cart/items')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ productId: String(productId) });

const checkout = (accessToken, idempotencyKey = '11111111-1111-4111-8111-111111111111') =>
  request(app)
    .post('/api/v1/orders')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ shippingAddress, notes: 'Please call before delivery', idempotencyKey });

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  await Promise.all([
    User.init(),
    Category.init(),
    Product.init(),
    Cart.init(),
    CheckoutGroup.init(),
    Order.init(),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Category.deleteMany({}),
    Product.deleteMany({}),
    Cart.deleteMany({}),
    CheckoutGroup.deleteMany({}),
    Order.deleteMany({}),
  ]);
  category = await Category.create({ name: 'Áo khoác', slug: 'ao-khoac' });
});

describe('Cart API', () => {
  it('adds, rejects duplicate, removes, clears, and requires authentication', async () => {
    const buyer = await registerAndLogin('buyer@example.com');
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const product = await Product.create(productPayload(seller.user._id));

    await request(app).get('/api/v1/cart').expect(401);

    await addToCart(buyer.accessToken, product._id).expect(200);
    await addToCart(buyer.accessToken, product._id).expect(409);

    const cartResponse = await request(app)
      .get('/api/v1/cart')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);

    expect(cartResponse.body.data.cart.items).toHaveLength(1);
    expect(cartResponse.body.data.cart.estimatedSubtotal).toBe(250000);

    await request(app)
      .delete(`/api/v1/cart/items/${product.id}`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);

    await addToCart(buyer.accessToken, product._id).expect(200);
    const clearResponse = await request(app)
      .delete('/api/v1/cart')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);

    expect(clearResponse.body.data.cart.items).toHaveLength(0);
  });

  it('prevents adding own or unavailable products', async () => {
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const ownProduct = await Product.create(productPayload(seller.user._id));
    const draftProduct = await Product.create(productPayload(seller.user._id, { status: 'DRAFT' }));

    await addToCart(seller.accessToken, ownProduct._id).expect(403);
    const buyer = await registerAndLogin('buyer@example.com');
    await addToCart(buyer.accessToken, draftProduct._id).expect(400);
  });
});

describe('Checkout and orders', () => {
  it('creates a single-seller checkout using server-side price and commission', async () => {
    const buyer = await registerAndLogin('buyer@example.com');
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const product = await Product.create(productPayload(seller.user._id, { price: 333333 }));

    await addToCart(buyer.accessToken, product._id).expect(200);

    const response = await checkout(buyer.accessToken).expect(201);

    expect(response.body.data.checkout.orders).toHaveLength(1);
    expect(response.body.data.checkout.subtotal).toBe(333333);
    expect(response.body.data.checkout.orders[0].commissionRateBasisPoints).toBe(1000);
    expect(response.body.data.checkout.orders[0].commissionAmount).toBe(33333);
    expect(response.body.data.checkout.orders[0].sellerProceeds).toBe(300000);

    const reserved = await Product.findById(product._id);
    expect(reserved.status).toBe('RESERVED');
    expect((await Cart.findOne({ userId: buyer.user._id })).items).toHaveLength(0);
  });

  it('creates seller-specific orders for multi-seller checkout', async () => {
    const buyer = await registerAndLogin('buyer@example.com');
    const sellerA = await registerAndLogin('seller-a@example.com', roles.SELLER);
    const sellerB = await registerAndLogin('seller-b@example.com', roles.SELLER);
    const productA = await Product.create(
      productPayload(sellerA.user._id, { title: 'Seller A jacket' }),
    );
    const productB = await Product.create(
      productPayload(sellerB.user._id, { title: 'Seller B jacket' }),
    );

    await addToCart(buyer.accessToken, productA._id).expect(200);
    await addToCart(buyer.accessToken, productB._id).expect(200);

    const response = await checkout(buyer.accessToken).expect(201);

    expect(response.body.data.checkout.orders).toHaveLength(2);
    expect(await Order.countDocuments()).toBe(2);
  });

  it('rejects empty cart, invalid address, own product, and suspended seller products', async () => {
    const buyer = await registerAndLogin('buyer@example.com');
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);

    await checkout(buyer.accessToken).expect(400);

    const product = await Product.create(productPayload(seller.user._id));
    await addToCart(buyer.accessToken, product._id).expect(200);
    await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        shippingAddress: { ...shippingAddress, city: '' },
        idempotencyKey: '22222222-2222-4222-8222-222222222222',
      })
      .expect(400);

    await User.updateOne({ _id: seller.user._id }, { status: 'SUSPENDED' });
    await checkout(buyer.accessToken, '33333333-3333-4333-8333-333333333333').expect(409);
  });

  it('prevents concurrent checkout of the same product and rolls back partial reservation', async () => {
    const buyerA = await registerAndLogin('buyer-a@example.com');
    const buyerB = await registerAndLogin('buyer-b@example.com');
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const product = await Product.create(productPayload(seller.user._id));

    await addToCart(buyerA.accessToken, product._id).expect(200);
    await addToCart(buyerB.accessToken, product._id).expect(200);

    const results = await Promise.allSettled([
      checkout(buyerA.accessToken, '44444444-4444-4444-8444-444444444444'),
      checkout(buyerB.accessToken, '55555555-5555-4555-8555-555555555555'),
    ]);
    const statuses = results.map((result) => result.value.status).sort();

    expect(statuses).toEqual([201, 409]);
    expect(await Order.countDocuments()).toBe(1);
    expect((await Product.findById(product._id)).status).toBe('RESERVED');
  });

  it('handles repeated idempotency keys safely', async () => {
    const buyer = await registerAndLogin('buyer@example.com');
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const product = await Product.create(productPayload(seller.user._id));
    const key = '66666666-6666-4666-8666-666666666666';

    await addToCart(buyer.accessToken, product._id).expect(200);

    const first = await checkout(buyer.accessToken, key).expect(201);
    const repeated = await checkout(buyer.accessToken, key).expect(201);

    expect(repeated.body.data.checkout.id).toBe(first.body.data.checkout.id);
    expect(await Order.countDocuments()).toBe(1);

    await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        shippingAddress: { ...shippingAddress, city: 'Ha Noi' },
        idempotencyKey: key,
      })
      .expect(409);
  });

  it('enforces buyer, seller, and admin order access', async () => {
    const buyer = await registerAndLogin('buyer@example.com');
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const other = await registerAndLogin('other@example.com');
    const admin = await registerAndLogin('admin@example.com', roles.ADMIN);
    const product = await Product.create(productPayload(seller.user._id));

    await addToCart(buyer.accessToken, product._id).expect(200);
    const checkoutResponse = await checkout(buyer.accessToken).expect(201);
    const orderId = checkoutResponse.body.data.checkout.orders[0]._id;

    await request(app)
      .get('/api/v1/orders/my')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
    await request(app)
      .get('/api/v1/seller/orders')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);
    await request(app)
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(403);
    await request(app)
      .get(`/api/v1/admin/orders/${orderId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
  });

  it('cancels unpaid orders, restores products, and prevents double or paid cancellation', async () => {
    const buyer = await registerAndLogin('buyer@example.com');
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const product = await Product.create(productPayload(seller.user._id));

    await addToCart(buyer.accessToken, product._id).expect(200);
    const checkoutResponse = await checkout(buyer.accessToken).expect(201);
    const orderId = checkoutResponse.body.data.checkout.orders[0]._id;

    await request(app)
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);

    expect((await Product.findById(product._id)).status).toBe('ACTIVE');
    await request(app)
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(409);

    const secondProduct = await Product.create(
      productPayload(seller.user._id, { title: 'Second jacket' }),
    );
    await addToCart(buyer.accessToken, secondProduct._id).expect(200);
    const secondCheckout = await checkout(
      buyer.accessToken,
      '77777777-7777-4777-8777-777777777777',
    ).expect(201);
    const secondOrderId = secondCheckout.body.data.checkout.orders[0]._id;
    await Order.updateOne({ _id: secondOrderId }, { paymentStatus: paymentStatus.PAID });

    await request(app)
      .post(`/api/v1/orders/${secondOrderId}/cancel`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(409);
  });
});

describe('Reservation expiry', () => {
  it('expires unpaid reservations and does not expire paid orders', async () => {
    const buyer = await registerAndLogin('buyer@example.com');
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const paidProduct = await Product.create(
      productPayload(seller.user._id, { title: 'Paid jacket' }),
    );
    const unpaidProduct = await Product.create(
      productPayload(seller.user._id, { title: 'Unpaid jacket' }),
    );

    await addToCart(buyer.accessToken, unpaidProduct._id).expect(200);
    const unpaidCheckout = await checkout(buyer.accessToken).expect(201);
    await CheckoutGroup.updateOne(
      { _id: unpaidCheckout.body.data.checkout.id },
      { reservationExpiresAt: new Date(Date.now() - 60 * 1000) },
    );
    await Order.updateMany(
      { checkoutGroupId: unpaidCheckout.body.data.checkout.id },
      { reservationExpiresAt: new Date(Date.now() - 60 * 1000) },
    );

    await addToCart(buyer.accessToken, paidProduct._id).expect(200);
    const paidCheckout = await checkout(
      buyer.accessToken,
      '88888888-8888-4888-8888-888888888888',
    ).expect(201);
    await CheckoutGroup.updateOne(
      { _id: paidCheckout.body.data.checkout.id },
      {
        reservationExpiresAt: new Date(Date.now() - 60 * 1000),
        paymentStatus: paymentStatus.PAID,
        orderStatus: orderStatus.PAID,
      },
    );
    await Order.updateMany(
      { checkoutGroupId: paidCheckout.body.data.checkout.id },
      {
        reservationExpiresAt: new Date(Date.now() - 60 * 1000),
        paymentStatus: paymentStatus.PAID,
        orderStatus: orderStatus.PAID,
      },
    );

    const [firstRun, secondRun] = await Promise.all([expireReservations(), expireReservations()]);

    expect(firstRun.expiredCount + secondRun.expiredCount).toBe(1);
    expect((await Product.findById(unpaidProduct._id)).status).toBe('ACTIVE');
    expect((await Product.findById(paidProduct._id)).status).toBe('RESERVED');
  });
});
