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
const { removeAddressDistrict } = require('../scripts/removeAddressDistrict');

let replSet;
let category;

const shippingAddress = {
  recipientName: 'Nguyen Van A',
  phone: '0901234567',
  addressLine: '123 Nguyen Trai',
  ward: 'Ben Thanh',
  city: 'Ho Chi Minh City',
};

const addressBody = {
  label: 'Home',
  recipientName: 'Seller Pickup',
  phone: '0901234567',
  addressLine: '45 Le Loi',
  ward: 'Ben Nghe',
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
  it('removes legacy districts without changing other address fields and can be rerun', async () => {
    const addressId = new mongoose.Types.ObjectId();
    const orderId = new mongoose.Types.ObjectId();
    const shipmentId = new mongoose.Types.ObjectId();
    const legacyAddress = { ...addressBody, district: 'Legacy district' };
    await Address.collection.insertOne({ _id: addressId, ...legacyAddress });
    await Order.collection.insertOne({
      _id: orderId,
      shippingAddress: { ...shippingAddress, district: 'Legacy district' },
    });
    await Shipment.collection.insertOne({
      _id: shipmentId,
      pickupAddressSnapshot: legacyAddress,
      deliveryAddressSnapshot: legacyAddress,
    });
    const preview = await removeAddressDistrict();
    expect(preview.collections.map((item) => item.matched)).toEqual([1, 1, 1]);
    expect((await Address.collection.findOne({ _id: addressId })).district).toBe('Legacy district');
    const result = await removeAddressDistrict({ apply: true });
    expect(result.collections.map((item) => item.remaining)).toEqual([0, 0, 0]);
    const address = await Address.collection.findOne({ _id: addressId });
    expect(address).toMatchObject(addressBody);
    expect(address).not.toHaveProperty('district');
    const order = await Order.collection.findOne({ _id: orderId });
    expect(order.shippingAddress).toEqual(shippingAddress);
    const shipment = await Shipment.collection.findOne({ _id: shipmentId });
    expect(shipment.pickupAddressSnapshot).toEqual(addressBody);
    expect(shipment.deliveryAddressSnapshot).toEqual(addressBody);
    const repeated = await removeAddressDistrict({ apply: true });
    expect(repeated.collections.map((item) => item.modified)).toEqual([0, 0, 0]);
  });

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

  it('rejects empty submissions and does not silently approve old simulated verification', async () => {
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const admin = await registerAndLogin('admin@example.com', roles.ADMIN);
    await request(app)
      .post('/api/v1/seller/profile')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ shopName: 'Sifit Vintage' })
      .expect(201);
    await request(app)
      .post('/api/v1/seller/verification/submit')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(400);
    const profile = await SellerProfile.findOne({ userId: seller.user._id });
    const legacy = await SellerVerification.create({
      sellerId: profile._id,
      verificationMethod: 'SIMULATED_REVIEW',
    });
    await request(app)
      .patch(`/api/v1/admin/seller-verifications/${legacy._id}/approve`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        expectedVersion: 0,
        reason: 'Need actual private verification documents',
        checkedDocuments: true,
      })
      .expect(409);
    expect((await SellerProfile.findOne({ userId: seller.user._id })).verificationStatus).toBe(
      'NOT_SUBMITTED',
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
    expect(first.body.data.address.addressType).toBe('SHIPPING');
    const seller = await registerAndLogin('pickup-seller@example.com', roles.SELLER);
    const pickup = await request(app)
      .post('/api/v1/addresses')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ ...addressBody, addressType: 'SHIPPING' })
      .expect(201);
    expect(pickup.body.data.address.addressType).toBe('BOTH');
    const updated = await request(app)
      .patch(`/api/v1/addresses/${second.body.data.address._id}`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ addressType: 'PICKUP' })
      .expect(200);
    expect(updated.body.data.address.addressType).toBe('SHIPPING');
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

describe('Shipping, delivery, and settlement', () => {
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

  it('retires dispute endpoints and returns normal buyer order details', async () => {
    const { buyer, seller, order } = await createPaidOrder();
    const admin = await registerAndLogin('admin@example.com', roles.ADMIN);
    const caseId = new mongoose.Types.ObjectId();
    const endpoints = [
      ['post', '/orders/' + order.id + '/disputes', buyer],
      ['get', '/disputes/my', buyer],
      ['get', '/disputes/' + caseId + '/evidence', buyer],
      ['post', '/disputes/' + caseId + '/return-shipment', buyer],
      ['get', '/seller/disputes', seller],
      ['get', '/admin/disputes', admin],
      ['patch', '/admin/disputes/' + caseId + '/resolve', admin],
      ['post', '/admin/orders/' + order.id + '/post-payout-dispute', admin],
    ];
    for (const [method, path, user] of endpoints) {
      await request(app)[method]('/api/v1' + path)
        .set('Authorization', 'Bearer ' + user.accessToken)
        .expect(404);
    }
    expect(await Dispute.countDocuments()).toBe(0);
    const result = await request(app).get('/api/v1/orders/my')
      .set('Authorization', 'Bearer ' + buyer.accessToken).expect(200);
    expect(result.body.data.items[0]).toMatchObject({
      paymentStatus: 'PAID', shippingAddress, reviewsBlocked: false,
    });
    expect(result.body.data.items[0]).not.toHaveProperty('disputeEligibility');
    expect(result.body.data.items[0]).not.toHaveProperty('activeDispute');
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
    expect((await Order.findById(order._id)).orderStatus).toBe(orderStatus.DELIVERED);
    const completionAdmin = await registerAndLogin('completion-admin@example.com', roles.ADMIN);
    await request(app)
      .post(`/api/v1/admin/orders/${order.id}/complete`)
      .set('Authorization', `Bearer ${completionAdmin.accessToken}`)
      .send({
        note: 'Delivery proof reviewed after buyer response deadline',
        allowUnconfirmed: true,
      })
      .expect(200);
    await Order.updateOne({ _id: order._id }, { completedAt: past });
    const result = await settlementEligibilityService.evaluateEligibleOrders({ now: new Date() });
    expect(result.eligibleCount).toBe(1);
    expect(
      await SellerPayout.countDocuments({ sellerId: seller.user._id, status: 'ELIGIBLE' }),
    ).toBe(1);
  });
});
