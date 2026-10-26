const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const app = require('../src/app');
const roles = require('../src/constants/roles');
const orderStatus = require('../src/constants/orderStatus');
const paymentStatus = require('../src/constants/paymentStatus');
const paymentAttemptStatus = require('../src/constants/paymentAttemptStatus');
const Category = require('../src/models/category.model');
const CheckoutGroup = require('../src/models/checkoutGroup.model');
const Commission = require('../src/models/commission.model');
const LedgerEntry = require('../src/models/ledgerEntry.model');
const Order = require('../src/models/order.model');
const Payment = require('../src/models/payment.model');
const PaymentWebhookEvent = require('../src/models/paymentWebhookEvent.model');
const Product = require('../src/models/product.model');
const Refund = require('../src/models/refund.model');
const SellerPayout = require('../src/models/sellerPayout.model');
const User = require('../src/models/user.model');
const SimulatorProvider = require('../src/services/paymentProviders/simulator.provider');

let replSet;
let category;

const shippingAddress = {
  recipientName: 'Nguyen Van A',
  phone: '0901234567',
  addressLine: '123 Nguyen Trai',
  ward: 'Ben Thanh',
  city: 'Ho Chi Minh City',
};

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
  return { accessToken: response.body.data.accessToken, user };
};

const productPayload = (sellerId, overrides = {}) => ({
  sellerId,
  title: overrides.title || 'Vintage denim jacket',
  description: 'A clean second-hand item.',
  price: overrides.price || 200000,
  categoryId: category._id,
  brand: 'Levis',
  size: 'M',
  color: 'Blue',
  condition: 'GOOD',
  status: 'ACTIVE',
  images: [{ url: 'https://example.com/image.png', publicId: 'sifit/products/image' }],
  ...overrides,
});

const createCheckoutAndPayment = async () => {
  const buyer = await registerAndLogin('buyer@example.com');
  const seller = await registerAndLogin('seller@example.com', roles.SELLER);
  const product = await Product.create(productPayload(seller.user._id));

  await request(app)
    .post('/api/v1/cart/items')
    .set('Authorization', `Bearer ${buyer.accessToken}`)
    .send({ productId: product.id })
    .expect(200);

  const checkoutResponse = await request(app)
    .post('/api/v1/orders')
    .set('Authorization', `Bearer ${buyer.accessToken}`)
    .send({
      shippingAddress,
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    })
    .expect(201);

  const paymentResponse = await request(app)
    .post('/api/v1/payments')
    .set('Authorization', `Bearer ${buyer.accessToken}`)
    .send({
      checkoutGroupId: checkoutResponse.body.data.checkout.id,
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
    })
    .expect(201);

  const payment = await Payment.findById(paymentResponse.body.data.payment.id);

  return {
    buyer,
    seller,
    product,
    checkout: checkoutResponse.body.data.checkout,
    payment,
  };
};

const signedPayload = (payload) => {
  const provider = new SimulatorProvider();
  return provider.createSignature(payload);
};

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
    CheckoutGroup.init(),
    Order.init(),
    Payment.init(),
    PaymentWebhookEvent.init(),
    Commission.init(),
    LedgerEntry.init(),
    SellerPayout.init(),
    Refund.init(),
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
    CheckoutGroup.deleteMany({}),
    Order.deleteMany({}),
    Payment.deleteMany({}),
    PaymentWebhookEvent.deleteMany({}),
    Commission.deleteMany({}),
    LedgerEntry.deleteMany({}),
    SellerPayout.deleteMany({}),
    Refund.deleteMany({}),
  ]);
  category = await Category.create({ name: 'Áo khoác', slug: 'ao-khoac' });
});

describe('Payment simulator foundation', () => {
  it('creates payments from trusted checkout totals and handles idempotency', async () => {
    const { buyer, checkout, payment } = await createCheckoutAndPayment();

    expect(payment.amount).toBe(200000);
    expect(payment.status).toBe(paymentAttemptStatus.PENDING);

    const repeated = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        checkoutGroupId: checkout.id,
        idempotencyKey: '22222222-2222-4222-8222-222222222222',
      })
      .expect(201);

    expect(repeated.body.data.payment.id).toBe(String(payment._id));

    await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        checkoutGroupId: new mongoose.Types.ObjectId().toString(),
        idempotencyKey: '22222222-2222-4222-8222-222222222222',
      })
      .expect(409);
  });

  it('enforces payment ownership', async () => {
    const { payment } = await createCheckoutAndPayment();
    const other = await registerAndLogin('other@example.com');

    await request(app)
      .get(`/api/v1/payments/${payment.id}`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(403);
  });

  it('processes valid signed successful webhooks idempotently', async () => {
    const { payment, product } = await createCheckoutAndPayment();
    const payload = {
      eventId: 'evt_success_1',
      eventType: 'payment.succeeded',
      providerPaymentId: payment.providerPaymentId,
      merchantReference: payment.merchantReference,
      amount: payment.amount,
      currency: 'VND',
      status: 'SUCCEEDED',
      occurredAt: new Date().toISOString(),
    };

    await request(app)
      .post('/api/v1/webhooks/payments/simulator')
      .set('x-sifit-signature', signedPayload(payload))
      .send(payload)
      .expect(200);

    await request(app)
      .post('/api/v1/webhooks/payments/simulator')
      .set('x-sifit-signature', signedPayload(payload))
      .send(payload)
      .expect(200);

    expect((await Payment.findById(payment._id)).status).toBe(paymentAttemptStatus.SUCCEEDED);
    expect((await CheckoutGroup.findById(payment.checkoutGroupId)).paymentStatus).toBe(
      paymentStatus.PAID,
    );
    expect((await Order.findOne({ checkoutGroupId: payment.checkoutGroupId })).orderStatus).toBe(
      orderStatus.PAID,
    );
    expect((await Product.findById(product._id)).status).toBe('SOLD');
    expect(await Commission.countDocuments()).toBe(1);
    expect(await LedgerEntry.countDocuments()).toBe(1);

    const ledger = await LedgerEntry.findOne();
    const debit = ledger.lines.reduce((sum, line) => sum + line.debit, 0);
    const credit = ledger.lines.reduce((sum, line) => sum + line.credit, 0);
    expect(debit).toBe(credit);
  });

  it('rejects invalid signatures and detects amount mismatch', async () => {
    const { payment } = await createCheckoutAndPayment();
    const payload = {
      eventId: 'evt_bad_amount',
      eventType: 'payment.succeeded',
      providerPaymentId: payment.providerPaymentId,
      merchantReference: payment.merchantReference,
      amount: payment.amount + 1,
      currency: 'VND',
      status: 'SUCCEEDED',
    };

    await request(app)
      .post('/api/v1/webhooks/payments/simulator')
      .set('x-sifit-signature', 'bad')
      .send(payload)
      .expect(401);

    await request(app)
      .post('/api/v1/webhooks/payments/simulator')
      .set('x-sifit-signature', signedPayload(payload))
      .send(payload)
      .expect(409);
  });

  it('records late payment success as an exception without marking checkout paid', async () => {
    const { payment } = await createCheckoutAndPayment();
    await CheckoutGroup.updateOne(
      { _id: payment.checkoutGroupId },
      { orderStatus: orderStatus.CANCELLED, reservationExpiresAt: new Date(Date.now() - 1000) },
    );
    const payload = {
      eventId: 'evt_late_success',
      eventType: 'payment.succeeded',
      providerPaymentId: payment.providerPaymentId,
      merchantReference: payment.merchantReference,
      amount: payment.amount,
      currency: 'VND',
      status: 'SUCCEEDED',
    };

    await request(app)
      .post('/api/v1/webhooks/payments/simulator')
      .set('x-sifit-signature', signedPayload(payload))
      .send(payload)
      .expect(200);

    const updatedPayment = await Payment.findById(payment._id);
    const group = await CheckoutGroup.findById(payment.checkoutGroupId);
    expect(updatedPayment.metadata.exception).toBe('paid_after_checkout_ineligible');
    expect(group.paymentStatus).toBe(paymentStatus.UNPAID);
  });

  it('supports seller earnings, admin finance listing, payout approval, and refund request records', async () => {
    const { seller, payment } = await createCheckoutAndPayment();
    const payload = {
      eventId: 'evt_finance_1',
      eventType: 'payment.succeeded',
      providerPaymentId: payment.providerPaymentId,
      merchantReference: payment.merchantReference,
      amount: payment.amount,
      currency: 'VND',
      status: 'SUCCEEDED',
    };
    await request(app)
      .post('/api/v1/webhooks/payments/simulator')
      .set('x-sifit-signature', signedPayload(payload))
      .send(payload)
      .expect(200);

    const sellerLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'seller@example.com', password: 'StrongPassword123!' })
      .expect(200);

    const earnings = await request(app)
      .get('/api/v1/seller/earnings')
      .set('Authorization', `Bearer ${sellerLogin.body.data.accessToken}`)
      .expect(200);
    expect(earnings.body.data.earnings.pendingProceeds).toBe(180000);

    const admin = await registerAndLogin('admin@example.com', roles.ADMIN);
    await request(app)
      .get('/api/v1/admin/payments')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    await request(app)
      .get('/api/v1/admin/financial-summary')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    const order = await Order.findOne({ sellerId: seller.user._id });
    const payout = await SellerPayout.create({
      sellerId: seller.user._id,
      orderIds: [order._id],
      amount: order.sellerProceeds,
      status: 'ELIGIBLE',
      requestedAt: new Date(),
    });

    await request(app)
      .post(`/api/v1/admin/payouts/${payout.id}/approve`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    await request(app)
      .post('/api/v1/admin/refunds')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        paymentId: payment.id,
        amount: 50000,
        idempotencyKey: '33333333-3333-4333-8333-333333333333',
        reason: 'Customer service refund',
      })
      .expect(201);

    expect(await Refund.countDocuments()).toBe(1);
  });
});
