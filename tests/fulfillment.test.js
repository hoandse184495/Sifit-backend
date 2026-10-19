const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const app = require('../src/app');
const roles = require('../src/constants/roles');
const orderStatus = require('../src/constants/orderStatus');
const Address = require('../src/models/address.model');
const Category = require('../src/models/category.model');
const CheckoutGroup = require('../src/models/checkoutGroup.model');
const Commission = require('../src/models/commission.model');
const Dispute = require('../src/models/dispute.model');
const LedgerEntry = require('../src/models/ledgerEntry.model');
const Order = require('../src/models/order.model');
const Payment = require('../src/models/payment.model');
const PaymentWebhookEvent = require('../src/models/paymentWebhookEvent.model');
const Product = require('../src/models/product.model');
const SellerPayout = require('../src/models/sellerPayout.model');
const SellerProfile = require('../src/models/sellerProfile.model');
const SellerVerification = require('../src/models/sellerVerification.model');
const Shipment = require('../src/models/shipment.model');
const ShipmentEvent = require('../src/models/shipmentEvent.model');
const User = require('../src/models/user.model');
const SimulatorPaymentProvider = require('../src/services/paymentProviders/simulator.provider');
const SimulatorShippingProvider = require('../src/services/shippingProviders/simulator.provider');
const deliveryService = require('../src/services/delivery.service');
const settlementEligibilityService = require('../src/services/settlementEligibility.service');

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

const addressBody = {
  label: 'Home',
  recipientName: 'Seller Pickup',
  phone: '0901234567',
  addressLine: '45 Le Loi',
  ward: 'Ben Nghe',
  district: 'District 1',
  province: 'Ho Chi Minh City',
  addressType: 'PICKUP',
  isDefault: true,
};

const registerAndLogin = async (email, role = roles.BUYER) => {
  const password = 'StrongPassword123!';
  await request(app)
    .post('/api/v1/auth/register')
    .send({ fullName: email.split('@')[0], email, password })
    .expect(201);
  if (role !== roles.BUYER) await User.updateOne({ email }, { role });
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  const user = await User.findOne({ email });
  return { accessToken: response.body.data.accessToken, user };
};

const productPayload = (sellerId) => ({
  sellerId,
  title: 'Vintage denim jacket',
  description: 'A clean second-hand item.',
  price: 200000,
  categoryId: category._id,
  brand: 'Levis',
  size: 'M',
  color: 'Blue',
  condition: 'GOOD',
  status: 'ACTIVE',
  images: [{ url: 'https://example.com/image.png', publicId: 'sifit/products/image' }],
});

const signedPaymentPayload = (payload) => new SimulatorPaymentProvider().createSignature(payload);
const signedShippingPayload = (payload) => new SimulatorShippingProvider().sign(payload);

const createPaidOrder = async () => {
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
    .send({ shippingAddress, idempotencyKey: '11111111-1111-4111-8111-111111111111' })
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
  const payload = {
    eventId: `evt_${payment.id}`,
    eventType: 'payment.succeeded',
    providerPaymentId: payment.providerPaymentId,
    merchantReference: payment.merchantReference,
    amount: payment.amount,
    currency: 'VND',
    status: 'SUCCEEDED',
  };
  await request(app)
    .post('/api/v1/webhooks/payments/simulator')
    .set('x-sifit-signature', signedPaymentPayload(payload))
    .send(payload)
    .expect(200);
  const order = await Order.findOne({ checkoutGroupId: payment.checkoutGroupId });
  return { buyer, seller, product, payment, order };
};

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
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
    SellerProfile.init(),
    SellerVerification.init(),
    Address.init(),
    Shipment.init(),
    ShipmentEvent.init(),
    Dispute.init(),
    SellerPayout.init(),
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
    SellerProfile.deleteMany({}),
    SellerVerification.deleteMany({}),
    Address.deleteMany({}),
    Shipment.deleteMany({}),
    ShipmentEvent.deleteMany({}),
    Dispute.deleteMany({}),
    SellerPayout.deleteMany({}),
  ]);
  category = await Category.create({ name: 'Áo khoác', slug: 'ao-khoac' });
});

describe('Seller profiles and addresses', () => {
  it('creates, prevents duplicates, updates, and exposes public shop safely', async () => {
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    await request(app)
      .post('/api/v1/seller/profile')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({
        shopName: 'Sifit Vintage',
        description: 'Vintage clothing',
        contactPhone: '0901234567',
      })
      .expect(201);
    await request(app)
      .post('/api/v1/seller/profile')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ shopName: 'Another Shop' })
      .expect(409);
    await request(app)
      .patch('/api/v1/seller/profile')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ description: 'Updated' })
      .expect(200);
    const publicShop = await request(app).get('/api/v1/shops/sifit-vintage').expect(200);
    expect(publicShop.body.data.shop.contactPhone).toBeUndefined();
  });

  it('submits and approves simulated seller verification', async () => {
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const admin = await registerAndLogin('admin@example.com', roles.ADMIN);
    await request(app)
      .post('/api/v1/seller/profile')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ shopName: 'Sifit Vintage' })
      .expect(201);
    const submit = await request(app)
      .post('/api/v1/seller/verification/submit')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(201);
    await request(app)
      .patch(`/api/v1/admin/seller-verifications/${submit.body.data.verification._id}/approve`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect((await SellerProfile.findOne({ userId: seller.user._id })).verificationStatus).toBe(
      'VERIFIED',
    );
  });

  it('manages addresses with ownership and default handling', async () => {
    const user = await registerAndLogin('user@example.com');
    const other = await registerAndLogin('other@example.com');
    const first = await request(app)
      .post('/api/v1/addresses')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send(addressBody)
      .expect(201);
    const second = await request(app)
      .post('/api/v1/addresses')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ ...addressBody, label: 'Warehouse', addressLine: '99 Dong Khoi' })
      .expect(201);
    await request(app)
      .patch(`/api/v1/addresses/${second.body.data.address._id}/default`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);
    expect((await Address.findById(first.body.data.address._id)).isDefault).toBe(false);
    await request(app)
      .patch(`/api/v1/addresses/${first.body.data.address._id}`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .send({ label: 'Hacked' })
      .expect(404);
  });
});

describe('Shipping, delivery, disputes, and settlement', () => {
  it('quotes, creates shipment, processes delivery webhook, and buyer confirms receipt', async () => {
    const { buyer, seller, order } = await createPaidOrder();
    await SellerProfile.create({
      userId: seller.user._id,
      shopName: 'Sifit Vintage',
      shopSlug: 'sifit-vintage',
    });
    const pickup = await Address.create({ ...addressBody, userId: seller.user._id });

    await request(app)
      .post('/api/v1/shipping/quote')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({
        orderId: order.id,
        pickupAddressId: pickup.id,
        weightGrams: 500,
        packageLengthCm: 25,
        packageWidthCm: 20,
        packageHeightCm: 10,
      })
      .expect(200);

    const shipmentResponse = await request(app)
      .post(`/api/v1/seller/orders/${order.id}/shipments`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({
        pickupAddressId: pickup.id,
        idempotencyKey: '33333333-3333-4333-8333-333333333333',
        weightGrams: 500,
        packageLengthCm: 25,
        packageWidthCm: 20,
        packageHeightCm: 10,
      })
      .expect(201);

    await request(app)
      .post(`/api/v1/seller/orders/${order.id}/shipments`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({
        pickupAddressId: pickup.id,
        idempotencyKey: '33333333-3333-4333-8333-333333333333',
        weightGrams: 500,
        packageLengthCm: 25,
        packageWidthCm: 20,
        packageHeightCm: 10,
      })
      .expect(201);

    const shipment = await Shipment.findById(shipmentResponse.body.data.shipment._id);
    const payload = {
      eventId: 'ship_evt_delivered',
      eventType: 'shipment.delivered',
      providerShipmentId: shipment.providerShipmentId,
      trackingNumber: shipment.trackingNumber,
      status: 'DELIVERED',
      occurredAt: new Date().toISOString(),
    };
    await request(app)
      .post('/api/v1/webhooks/shipping/simulator')
      .set('x-sifit-signature', 'bad')
      .send(payload)
      .expect(401);
    await request(app)
      .post('/api/v1/webhooks/shipping/simulator')
      .set('x-sifit-signature', signedShippingPayload(payload))
      .send(payload)
      .expect(200);
    await request(app)
      .post('/api/v1/webhooks/shipping/simulator')
      .set('x-sifit-signature', signedShippingPayload(payload))
      .send(payload)
      .expect(200);

    const deliveredOrder = await Order.findById(order._id);
    expect(deliveredOrder.orderStatus).toBe(orderStatus.DELIVERED);
    expect(deliveredOrder.protectionEndsAt).toBeInstanceOf(Date);
    await request(app)
      .post(`/api/v1/orders/${order.id}/confirm-receipt`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(403);
    await request(app)
      .post(`/api/v1/orders/${order.id}/confirm-receipt`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
  });

  it('opens a non-delivery dispute for paid unshipped and shipped orders without auto-refunding', async () => {
    const { buyer, seller, order } = await createPaidOrder();
    const endpoint = `/api/v1/orders/${order.id}/disputes`;
    await request(app)
      .post(endpoint)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ reason: 'ITEM_NOT_RECEIVED', description: 'Not the buyer' })
      .expect(403);
    await request(app)
      .post(endpoint)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ reason: 'DAMAGED_ITEM', description: 'No delivery yet' })
      .expect(409);
    const available = await request(app)
      .get('/api/v1/orders/my')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
    expect(available.body.data.items[0].disputeEligibility.allowedReasons).toEqual([
      'ITEM_NOT_RECEIVED',
    ]);
    expect(available.body.data.items[0].shippingAddress).toMatchObject(shippingAddress);
    expect(available.body.data.items[0].reservationExpiresAt).toBeTruthy();
    for (const status of ['PAID', 'PROCESSING', 'SHIPPED']) {
      await Order.updateOne({ _id: order._id }, { orderStatus: status });
      const created = await request(app)
        .post(endpoint)
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .send({ reason: 'ITEM_NOT_RECEIVED', description: `Not received in ${status}` })
        .expect(201);
      const fresh = await Order.findById(order._id);
      expect(fresh.orderStatus).toBe(status);
      expect(fresh.paymentStatus).toBe('PAID');
      const listed = await request(app)
        .get('/api/v1/orders/my')
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .expect(200);
      expect(listed.body.data.items[0].disputeEligibility.eligible).toBe(false);
      expect(listed.body.data.items[0].activeDispute._id).toBe(created.body.data.dispute._id);
      await request(app)
        .post(endpoint)
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .send({ reason: 'ITEM_NOT_RECEIVED', description: 'Duplicate case' })
        .expect(409);
      await Dispute.updateOne({ _id: created.body.data.dispute._id }, { status: 'CLOSED' });
    }
  });

  it('rejects unpaid or terminal orders and expired post-delivery dispute windows', async () => {
    const { buyer, order } = await createPaidOrder();
    for (const state of [
      { orderStatus: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' },
      { orderStatus: 'CANCELLED', paymentStatus: 'PAID' },
      { orderStatus: 'REFUNDED', paymentStatus: 'REFUNDED' },
      {
        orderStatus: 'DELIVERED',
        paymentStatus: 'PAID',
        deliveredAt: new Date(Date.now() - 86400000),
        protectionEndsAt: new Date(Date.now() - 1000),
      },
    ]) {
      await Order.updateOne({ _id: order._id }, state);
      await request(app)
        .post(`/api/v1/orders/${order.id}/disputes`)
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .send({ reason: 'ITEM_NOT_RECEIVED', description: 'Ineligible case' })
        .expect(409);
    }
    expect(await Dispute.countDocuments()).toBe(0);
  });

  it('opens, reviews, and resolves disputes while enforcing access', async () => {
    const { buyer, seller, order } = await createPaidOrder();
    const admin = await registerAndLogin('admin@example.com', roles.ADMIN);
    await Order.updateOne(
      { _id: order._id },
      {
        orderStatus: orderStatus.DELIVERED,
        deliveredAt: new Date(),
        protectionEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    );
    const dispute = await request(app)
      .post(`/api/v1/orders/${order.id}/disputes`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ reason: 'ITEM_NOT_AS_DESCRIBED', description: 'The item condition is different.' })
      .expect(201);
    await request(app)
      .post(`/api/v1/orders/${order.id}/disputes`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ reason: 'OTHER', description: 'Duplicate' })
      .expect(409);
    await request(app)
      .get(`/api/v1/disputes/${dispute.body.data.dispute._id}`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);
    await request(app)
      .patch(`/api/v1/admin/disputes/${dispute.body.data.dispute._id}/review`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ note: 'Checking evidence' })
      .expect(200);
    await request(app)
      .patch(`/api/v1/admin/disputes/${dispute.body.data.dispute._id}/resolve`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ status: 'RESOLVED_SELLER', resolution: 'No issue found' })
      .expect(200);
  });

  it('completes eligible orders and creates eligible payout records only after verification and hold', async () => {
    const { seller, order } = await createPaidOrder();
    await SellerProfile.create({
      userId: seller.user._id,
      shopName: 'Sifit Vintage',
      shopSlug: 'sifit-vintage',
      verificationStatus: 'VERIFIED',
    });
    const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await Order.updateOne(
      { _id: order._id },
      { orderStatus: orderStatus.DELIVERED, deliveredAt: past, protectionEndsAt: past },
    );
    await deliveryService.completeEligibleOrders({ now: new Date() });
    await Order.updateOne({ _id: order._id }, { completedAt: past });
    const result = await settlementEligibilityService.evaluateEligibleOrders({ now: new Date() });
    expect(result.eligibleCount).toBe(1);
    expect(
      await SellerPayout.countDocuments({ sellerId: seller.user._id, status: 'ELIGIBLE' }),
    ).toBe(1);
  });
});
