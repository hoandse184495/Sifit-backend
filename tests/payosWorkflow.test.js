const mongoose = require('mongoose');
const request = require('supertest');
const crypto = require('crypto');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { PayOS } = require('@payos/node');
const app = require('../src/app');
const env = require('../src/config/env');
const config = require('../src/config/payos');
const User = require('../src/models/user.model');
const Product = require('../src/models/product.model');
const Category = require('../src/models/category.model');
const Order = require('../src/models/order.model');
const Group = require('../src/models/checkoutGroup.model');
const Payment = require('../src/models/payment.model');
const Receipt = require('../src/models/paymentTransaction.model');
const Ledger = require('../src/models/ledgerEntry.model');
const Profile = require('../src/models/sellerProfile.model');
const Payout = require('../src/models/sellerPayout.model');
const Commission = require('../src/models/commission.model');
const Address = require('../src/models/address.model');
const Shipment = require('../src/models/shipment.model');
const Audit = require('../src/models/adminAuditLog.model');
const delivery = require('../src/services/delivery.service');
const settlements = require('../src/services/settlementEligibility.service');
const reservations = require('../src/services/reservation.service');
const payments = require('../src/services/payment.service');
const { signAccessToken } = require('../src/utils/token');
let mongo, sdk, buyer, seller, admin, other, group, order, product, pickup;
const auth = (user) => `Bearer ${signAccessToken(user)}`;
const api = (method, path, user = buyer) =>
  request(app)[method](`/api/v1${path}`).set('Authorization', auth(user));
const create = (key) =>
  api('post', '/payments').send({
    checkoutGroupId: group.id,
    idempotencyKey: key || crypto.randomUUID(),
  });
const bank = {
  bankName: 'Fixture Bank',
  bankBin: '970422',
  accountNumber: '12345678',
  accountName: 'SELLER FIXTURE',
};
const note = 'Đã kiểm tra chứng từ và xác nhận giao dịch hợp lệ.';
const webhook = async (payment, amount = payment.amount, reference = crypto.randomUUID()) => {
  const data = {
    orderCode: Number(payment.merchantReference),
    amount,
    description: 'Fixture',
    accountNumber: '99887766',
    reference,
    transactionDateTime: '2026-11-08 12:00:00',
    currency: 'VND',
    paymentLinkId: payment.providerPaymentId,
    code: '00',
    desc: 'success',
  };
  return {
    code: '00',
    desc: 'success',
    success: true,
    data,
    signature: await sdk.crypto.createSignatureFromObj(data, sdk.checksumKey),
  };
};
const postWebhook = (body) => request(app).post('/api/v1/webhooks/payments/payos').send(body);
const pay = async () => {
  const response = await create().expect(201);
  const payment = response.body.data.payment;
  await postWebhook(await webhook(payment)).expect(200);
  return payment;
};
const complete = () => api('post', `/admin/orders/${order.id}/complete`, admin).send({ note });
const preparePayout = async () => {
  await pay();
  await Order.updateOne(
    { _id: order._id },
    {
      orderStatus: 'DELIVERED',
      deliveredAt: new Date(),
      buyerConfirmedAt: new Date(),
      protectionEndsAt: new Date(Date.now() - 1000),
    },
  );
  await complete().expect(200);
  await api('put', '/seller/bank-account', seller).send(bank).expect(200);
  await require('./helpers/verifiedSeller')(seller._id);
  await settlements.evaluateEligibleOrders();
  return Payout.findOne();
};

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
  Object.assign(env, {
    PAYMENT_PROVIDER: 'payos',
    SHIPPING_PROVIDER: 'manual',
    PAYOUT_MODE: 'manual',
    PAYOUT_HOLD_DAYS: 0,
  });
  sdk = new PayOS({
    clientId: 'fixture-client',
    apiKey: 'fixture-api',
    checksumKey: 'fixture-checksum-key',
    logLevel: 'off',
  });
  jest.spyOn(config, 'getClient').mockReturnValue(sdk);
  jest.spyOn(sdk.paymentRequests, 'create').mockImplementation(async (data) => ({
    ...data,
    currency: 'VND',
    paymentLinkId: `link${data.orderCode}`,
    checkoutUrl: `https://pay.payos.vn/web/link${data.orderCode}`,
    qrCode: `FIXTURE-QR-${data.orderCode}`,
    bin: '970422',
    accountName: 'SIFIT FIXTURE',
    accountNumber: '99887766',
  }));
  jest
    .spyOn(sdk.paymentRequests, 'get')
    .mockRejectedValue(new Error('No external network in tests'));
  [buyer, seller, admin, other] = await User.create(
    ['BUYER', 'SELLER', 'ADMIN', 'BUYER'].map((role, index) => ({
      fullName: `Fixture ${index}`,
      email: `payos${index}@fixture.test`,
      role,
      passwordHash: 'fixture',
    })),
  );
  await Profile.create({
    userId: seller._id,
    shopName: 'Fixture Shop',
    shopSlug: 'fixture-shop',
    verificationStatus: 'VERIFIED',
  });
  const category = await Category.create({ name: 'Áo', slug: 'ao' });
  product = await Product.create({
    sellerId: seller._id,
    categoryId: category._id,
    title: 'Fixture cotton shirt',
    description: 'A test garment',
    price: 100000,
    size: 'M',
    condition: 'GOOD',
    status: 'RESERVED',
  });
  group = await Group.create({
    buyerId: buyer._id,
    idempotencyKey: crypto.randomUUID(),
    requestFingerprint: 'fixture',
    subtotal: 100000,
    shippingFee: 0,
    buyerTotal: 100000,
    reservationExpiresAt: new Date(Date.now() + 900000),
  });
  order = await Order.create({
    buyerId: buyer._id,
    sellerId: seller._id,
    checkoutGroupId: group._id,
    items: [{ productId: product._id, title: product.title, price: product.price, quantity: 1 }],
    shippingAddress: {
      recipientName: 'Buyer Fixture',
      phone: '0901234567',
      addressLine: '123 Test Street',
      ward: 'Ward',
      city: 'City',
    },
    subtotal: 100000,
    shippingFee: 0,
    buyerTotal: 100000,
    commissionRateBasisPoints: 1000,
    commissionAmount: 10000,
    sellerProceeds: 90000,
    reservationExpiresAt: group.reservationExpiresAt,
  });
  pickup = await Address.create({
    userId: seller._id,
    addressType: 'PICKUP',
    label: 'Shop',
    recipientName: seller.fullName,
    phone: '0901234567',
    addressLine: '456 Fixture Street',
    ward: 'Ward',
    province: 'City',
  });
});

it('uses trusted totals, serializes concurrent QR requests, never exposes keys and retries one orderCode', async () => {
  const results = await Promise.all([create(), create(), create()]);
  expect(results.every((result) => result.status === 201)).toBe(true);
  expect(await Payment.countDocuments()).toBe(1);
  expect(sdk.paymentRequests.create).toHaveBeenCalledTimes(1);
  const payment = await Payment.findOne();
  expect(payment.amount).toBe(group.buyerTotal);
  expect(payment.qrCode).toBeTruthy();
  expect(sdk.paymentRequests.create.mock.calls[0][0].returnUrl).toContain(
    `paymentId=${payment.id}`,
  );
  expect(JSON.stringify(results)).not.toContain('fixture-checksum-key');
  await api('get', `/payments/${payment.id}`, other).expect(403);
});
it('keeps one retryable payment after provider timeout instead of making a second reference', async () => {
  sdk.paymentRequests.create.mockRejectedValueOnce(new Error('Timeout'));
  const key = crypto.randomUUID();
  await create(key).expect(502);
  const first = await Payment.findOne();
  await create(key).expect(201);
  expect(await Payment.countDocuments()).toBe(1);
  expect(sdk.paymentRequests.create.mock.calls[1][0].orderCode).toBe(
    Number(first.merchantReference),
  );
});
it('rejects forged signatures and records exact incoming receipts only once even concurrently', async () => {
  const payment = (await create()).body.data.payment;
  const body = await webhook(payment);
  await postWebhook({ ...body, signature: 'bad' }).expect(401);
  expect(await Receipt.countDocuments()).toBe(0);
  const results = await Promise.all([postWebhook(body), postWebhook(body), postWebhook(body)]);
  expect(results.every((result) => result.status === 200)).toBe(true);
  expect(await Receipt.countDocuments()).toBe(1);
  expect(await Ledger.countDocuments()).toBe(2);
  expect(await Commission.countDocuments()).toBe(1);
  expect((await Order.findById(order._id)).orderStatus).toBe('PAID');
});
it('does not mark underpaid/overpaid as paid; preserves receipts and allocates only the exact total', async () => {
  const payment = (await create()).body.data.payment;
  await postWebhook(await webhook(payment, 40000, 'PART-1')).expect(200);
  expect((await Order.findById(order._id)).paymentStatus).toBe('UNPAID');
  await postWebhook(await webhook(payment, 60000, 'PART-2')).expect(200);
  expect((await Order.findById(order._id)).paymentStatus).toBe('PAID');
  await postWebhook(await webhook(payment, 10000, 'EXTRA')).expect(200);
  const record = await Payment.findById(payment.id);
  expect(record.metadata.exception).toBe('additional_payment_after_success');
  expect(record.metadata.receivedAmount).toBe(110000);
  expect(await Receipt.countDocuments()).toBe(3);
  expect(await Ledger.countDocuments({ sourceType: 'PAYMENT' })).toBe(1);
});
it('handles early webhook before QR response without regressing SUCCEEDED to PENDING', async () => {
  sdk.paymentRequests.create.mockImplementationOnce(async (data) => {
    const payment = await Payment.findOne();
    const providerId = `link${data.orderCode}`;
    await postWebhook(
      await webhook(
        { ...payment.toObject(), id: payment.id, providerPaymentId: providerId },
        payment.amount,
      ),
    ).expect(200);
    return {
      amount: data.amount,
      orderCode: data.orderCode,
      currency: 'VND',
      paymentLinkId: providerId,
      checkoutUrl: `https://pay.payos.vn/web/${providerId}`,
      qrCode: 'FIXTURE',
    };
  });
  expect((await create().expect(201)).body.data.payment.status).toBe('SUCCEEDED');
});
it('records money after expiry without fulfilling a cancelled checkout', async () => {
  const payment = (await create()).body.data.payment;
  await Group.updateOne({ _id: group._id }, { orderStatus: 'CANCELLED' });
  await postWebhook(await webhook(payment)).expect(200);
  const record = await Payment.findById(payment.id);
  expect(record.status).toBe('SUCCEEDED');
  expect(record.metadata.exception).toBe('paid_after_checkout_ineligible');
  expect((await Order.findById(order.id)).paymentStatus).toBe('UNPAID');
  expect(await Receipt.countDocuments()).toBe(1);
  expect(await Ledger.countDocuments()).toBe(1);
});
it('reconciles missed webhooks from signed SDK queries without inventing a duplicate bank receipt', async () => {
  const payment = (await create()).body.data.payment;
  sdk.paymentRequests.get.mockResolvedValue({
    id: payment.providerPaymentId,
    orderCode: Number(payment.merchantReference),
    amount: payment.amount,
    amountPaid: payment.amount,
    amountRemaining: 0,
    status: 'PAID',
    transactions: [
      {
        reference: 'BANK-REF-1',
        amount: payment.amount,
        transactionDateTime: '2026-11-08 12:00:00',
      },
    ],
  });
  await api('get', `/payments/${payment.id}`).expect(200);
  await postWebhook(await webhook(payment, payment.amount, 'BANK-REF-1')).expect(200);
  expect(await Receipt.countDocuments()).toBe(1);
  expect(await Ledger.countDocuments()).toBe(2);
});
it('requires seller shipping and handover, buyer confirmation, then explicit admin completion', async () => {
  await pay();
  const body = {
    pickupAddressId: pickup.id,
    carrierName: 'Fixture Carrier',
    trackingNumber: 'TEST-TRACK-123',
    shippingFee: 25000,
    weightGrams: 500,
    packageLengthCm: 20,
    packageWidthCm: 15,
    packageHeightCm: 5,
    idempotencyKey: crypto.randomUUID(),
  };
  await api('post', `/seller/orders/${order.id}/manual-shipment`, buyer).send(body).expect(403);
  const response = await api('post', `/seller/orders/${order.id}/manual-shipment`, seller)
    .send(body)
    .expect(200);
  const shipment = response.body.data.shipment;
  expect((await Order.findById(order.id)).orderStatus).toBe('PROCESSING');
  await api('post', `/orders/${order.id}/confirm-receipt`).expect(409);
  await api('post', `/seller/shipments/${shipment._id}/handover`, seller)
    .send({ note })
    .expect(200);
  expect((await Order.findById(order.id)).orderStatus).toBe('SHIPPED');
  await api('post', `/orders/${order.id}/confirm-receipt`, other).expect(403);
  await api('post', `/orders/${order.id}/confirm-receipt`).expect(200);
  expect((await Shipment.findById(shipment._id)).status).toBe('DELIVERED');
  await delivery.completeEligibleOrders({ now: new Date(Date.now() + 30 * 86400000) });
  expect((await Order.findById(order.id)).orderStatus).toBe('DELIVERED');
  await complete().expect(200);
  expect((await Order.findById(order.id)).completedBy.toString()).toBe(admin.id);
  expect((await settlements.evaluateEligibleOrders()).eligibleCount).toBe(0);
});
it('requires proof/confirmation and blocks completion during an active dispute', async () => {
  await pay();
  await Order.updateOne(
    { _id: order._id },
    {
      orderStatus: 'DELIVERED',
      deliveredAt: new Date(),
      protectionEndsAt: new Date(Date.now() + 86400000),
    },
  );
  await complete().expect(409);
  await Order.updateOne({ _id: order._id }, { buyerConfirmedAt: new Date() });
  await api('post', `/orders/${order.id}/disputes`)
    .send({ reason: 'DAMAGED_ITEM', description: 'Damaged garment during transit' })
    .expect(201);
  await complete().expect(409);
});
it('keeps bank details private, snapshots approved bank and only marks PAID after real-transfer recording', async () => {
  const payout = await preparePayout();
  expect(payout.provider).toBe('manual');
  await api('get', '/seller/bank-account', buyer).expect(403);
  await api('post', `/admin/payouts/${payout.id}/record-transfer`, admin)
    .send({ reference: 'BANK-12345', note, amount: 90000, transferred: true })
    .expect(409);
  await api('post', `/admin/payouts/${payout.id}/approve`, admin).send({}).expect(200);
  await api('put', '/seller/bank-account', seller)
    .send({ ...bank, accountNumber: '87654321' })
    .expect(200);
  expect((await Payout.findById(payout.id)).bankSnapshot.accountNumber).toBe(bank.accountNumber);
  expect(
    (await require('../src/services/payout.service').processApprovedPayouts()).processedCount,
  ).toBe(0);
  await api('post', `/admin/payouts/${payout.id}/record-transfer`, admin)
    .send({ reference: 'BANK-12345', note, amount: 1, transferred: true })
    .expect(409);
  const body = { reference: 'BANK-12345', note, amount: 90000, transferred: true };
  const results = await Promise.all([
    api('post', `/admin/payouts/${payout.id}/record-transfer`, admin).send(body),
    api('post', `/admin/payouts/${payout.id}/record-transfer`, admin).send(body),
  ]);
  expect(results.every((result) => result.status === 200)).toBe(true);
  expect((await Payout.findById(payout.id)).status).toBe('PAID');
  expect((await Commission.findOne()).status).toBe('RECOGNIZED');
  expect(await Ledger.countDocuments({ sourceType: 'PAYOUT' })).toBe(1);
  expect(await Audit.countDocuments({ action: 'PAYOUT_TRANSFER_RECORDED' })).toBe(1);
});
it('rechecks holds before payout even after approval', async () => {
  const payout = await preparePayout();
  await api('post', `/admin/payouts/${payout.id}/approve`, admin).send({}).expect(200);
  await Payment.updateOne({}, { refundedAmount: 100 });
  await api('post', `/admin/payouts/${payout.id}/record-transfer`, admin)
    .send({ reference: 'BANK-12345', note, amount: 90000, transferred: true })
    .expect(409);
  expect((await Payout.findById(payout.id)).status).toBe('APPROVED');
});
it('rolls back final payout state if audit fails', async () => {
  const payout = await preparePayout();
  await api('post', `/admin/payouts/${payout.id}/approve`, admin).send({}).expect(200);
  jest
    .spyOn(require('../src/services/adminAudit.service'), 'record')
    .mockRejectedValueOnce(new Error('Audit unavailable'));
  await api('post', `/admin/payouts/${payout.id}/record-transfer`, admin)
    .send({ reference: 'BANK-12345', note, amount: 90000, transferred: true })
    .expect(500);
  expect((await Payout.findById(payout.id)).status).toBe('APPROVED');
  expect(await Ledger.countDocuments({ sourceType: 'PAYOUT' })).toBe(0);
});

const expiredPayosAttempt = async () => {
  const response = await create().expect(201);
  const payment = response.body.data.payment;
  await Group.updateOne({ _id: group._id }, { reservationExpiresAt: new Date(Date.now() - 60000) });
  await Payment.updateOne({ _id: payment.id }, { expiresAt: new Date(Date.now() - 60000) });
  return payment;
};
const providerState = (payment, overrides = {}) => ({
  id: payment.providerPaymentId,
  orderCode: Number(payment.merchantReference),
  amount: payment.amount,
  amountPaid: 0,
  status: 'EXPIRED',
  transactions: [],
  ...overrides,
});

it('automatically releases a PayOS order only after terminal unpaid confirmation, once across concurrent workers', async () => {
  const payment = await expiredPayosAttempt();
  sdk.paymentRequests.get.mockResolvedValue(providerState(payment));
  const runs = await Promise.all([
    reservations.expireReservations(),
    reservations.expireReservations(),
  ]);
  expect(runs.reduce((sum, run) => sum + run.expiredCount, 0)).toBe(1);
  expect((await Order.findById(order.id)).orderStatus).toBe('CANCELLED');
  expect((await Product.findById(product.id)).status).toBe('ACTIVE');
  expect((await Payment.findById(payment.id)).status).toBe('EXPIRED');
});

it('does not expire PayOS attempts or release stock on a provider outage', async () => {
  const payment = await expiredPayosAttempt();
  await payments.expirePendingPayments();
  expect((await Payment.findById(payment.id)).status).toBe('PENDING');
  const result = await reservations.expireReservations();
  expect(result.failedCount).toBe(1);
  expect(result.expiredCount).toBe(0);
  expect((await Group.findById(group.id)).orderStatus).toBe('PENDING_PAYMENT');
  expect((await Product.findById(product.id)).status).toBe('RESERVED');
});

it('keeps stock reserved while PayOS still reports a pending payment link', async () => {
  const payment = await expiredPayosAttempt();
  sdk.paymentRequests.get.mockResolvedValue(providerState(payment, { status: 'PENDING' }));
  expect((await reservations.expireReservations()).deferredCount).toBe(1);
  expect((await Product.findById(product.id)).status).toBe('RESERVED');
});

it('records money found during expiry reconciliation and holds late or partial receipts for review', async () => {
  const payment = await expiredPayosAttempt();
  sdk.paymentRequests.get.mockResolvedValue(
    providerState(payment, {
      status: 'UNDERPAID',
      amountPaid: 40000,
      transactions: [
        {
          reference: 'EXPIRY-PARTIAL-1',
          amount: 40000,
          transactionDateTime: '2026-11-08 12:00:00',
        },
      ],
    }),
  );
  expect((await reservations.expireReservations()).deferredCount).toBe(1);
  expect((await Product.findById(product.id)).status).toBe('RESERVED');
  expect((await Payment.findById(payment.id)).metadata.exception).toBe(
    'amount_or_currency_mismatch',
  );
  expect(await Receipt.countDocuments({ paymentId: payment.id })).toBe(1);
});

it('does not return paid inventory to sale when a delayed full-payment result is found', async () => {
  const payment = await expiredPayosAttempt();
  sdk.paymentRequests.get.mockResolvedValue(
    providerState(payment, {
      status: 'PAID',
      amountPaid: payment.amount,
      transactions: [
        {
          reference: 'EXPIRY-FULL-1',
          amount: payment.amount,
          transactionDateTime: '2026-11-08 12:00:00',
        },
      ],
    }),
  );
  expect((await reservations.expireReservations()).deferredCount).toBe(1);
  const record = await Payment.findById(payment.id);
  expect(record.status).toBe('SUCCEEDED');
  expect(record.metadata.exception).toBe('paid_after_checkout_ineligible');
  expect((await Group.findById(group.id)).orderStatus).toBe('PENDING_PAYMENT');
  expect((await Product.findById(product.id)).status).toBe('RESERVED');
  expect(await Receipt.countDocuments({ paymentId: payment.id })).toBe(1);
});

it('rechecks group eligibility after querying PayOS, before inventory release', async () => {
  const payment = await expiredPayosAttempt();
  sdk.paymentRequests.get.mockImplementation(async () => {
    // A concurrent verified-payment transaction wins while the expiry worker waits on the provider.
    await Group.updateOne({ _id: group.id }, { orderStatus: 'PAID', paymentStatus: 'PAID' });
    await Order.updateOne({ _id: order.id }, { orderStatus: 'PAID', paymentStatus: 'PAID' });
    await Product.updateOne({ _id: product.id }, { status: 'SOLD' });
    return providerState(payment);
  });
  expect((await reservations.expireReservations()).expiredCount).toBe(0);
  expect((await Order.findById(order.id)).orderStatus).toBe('PAID');
  expect((await Product.findById(product.id)).status).toBe('SOLD');
});

it('does not release inventory when PayOS reports funds without matching transaction history', async () => {
  const payment = await expiredPayosAttempt();
  sdk.paymentRequests.get.mockResolvedValue(providerState(payment, { amountPaid: 40000 }));
  expect((await reservations.expireReservations()).failedCount).toBe(1);
  expect((await Product.findById(product.id)).status).toBe('RESERVED');
  expect((await Group.findById(group.id)).orderStatus).toBe('PENDING_PAYMENT');
});
