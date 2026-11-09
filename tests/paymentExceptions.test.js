const crypto = require('node:crypto');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { PayOS } = require('@payos/node');
const app = require('../src/app');
const config = require('../src/config/payos');
const User = require('../src/models/user.model');
const Product = require('../src/models/product.model');
const Order = require('../src/models/order.model');
const Group = require('../src/models/checkoutGroup.model');
const Payment = require('../src/models/payment.model');
const Receipt = require('../src/models/paymentTransaction.model');
const Ledger = require('../src/models/ledgerEntry.model');
const Commission = require('../src/models/commission.model');
const Refund = require('../src/models/refund.model');
const Payout = require('../src/models/sellerPayout.model');
const Action = require('../src/models/paymentReviewAction.model');
const events = require('../src/services/notificationEvent.service');
const { signAccessToken } = require('../src/utils/token');
const { apiLimiter } = require('../src/middlewares/rateLimit.middleware');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);
let mongo, sdk, buyer, seller, admin, outsider, product, group, order, payment;
const address = {
  recipientName: 'Buyer',
  phone: '0901234567',
  addressLine: 'Test Street',
  ward: 'Ward',
  city: 'City',
};
const call = (method, path, user = admin) => {
  const action = request(app)[method](`/api/v1${path}`);
  return action
    .set('Authorization', `Bearer ${signAccessToken(user)}`)
    .set('X-Forwarded-For', '127.0.0.1');
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
  apiLimiter.resetKey('127.0.0.1');
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
  sdk = new PayOS({
    clientId: 'fixture-client',
    apiKey: 'fixture-api',
    checksumKey: 'fixture-checksum',
    logLevel: 'off',
  });
  jest.spyOn(config, 'getClient').mockReturnValue(sdk);
  jest
    .spyOn(sdk.paymentRequests, 'get')
    .mockRejectedValue(new Error('No external network in tests'));
  [buyer, seller, admin, outsider] = await User.create(
    ['BUYER', 'SELLER', 'ADMIN', 'BUYER'].map((role, i) => ({
      fullName: `Review fixture ${i}`,
      email: `review${i}@fixture.test`,
      role,
      passwordHash: 'fixture',
    })),
  );
  await require('../src/models/sellerProfile.model').create({
    userId: seller._id,
    shopName: 'Review shop',
    shopSlug: 'review-shop',
    verificationStatus: 'VERIFIED',
  });
  const category = await require('../src/models/category.model').create({
    name: 'Jackets',
    slug: 'jackets',
  });
  group = await Group.create({
    buyerId: buyer._id,
    idempotencyKey: crypto.randomUUID(),
    requestFingerprint: 'review',
    subtotal: 100000,
    buyerTotal: 100000,
    reservationExpiresAt: new Date(Date.now() + 900000),
  });
  product = await Product.create({
    sellerId: seller._id,
    categoryId: category._id,
    title: 'Review fixture jacket',
    description: 'A clean garment',
    price: 100000,
    size: 'M',
    condition: 'GOOD',
    status: 'RESERVED',
    reservationGroupId: group._id,
  });
  order = await Order.create({
    checkoutGroupId: group._id,
    buyerId: buyer._id,
    sellerId: seller._id,
    items: [{ productId: product._id, title: product.title, price: 100000, quantity: 1 }],
    shippingAddress: address,
    subtotal: 100000,
    buyerTotal: 100000,
    commissionRateBasisPoints: 1000,
    commissionAmount: 10000,
    sellerProceeds: 90000,
    reservationExpiresAt: group.reservationExpiresAt,
  });
  group.orderIds = [order._id];
  await group.save();
  payment = await Payment.create({
    checkoutGroupId: group._id,
    buyerId: buyer._id,
    provider: 'payos',
    providerPaymentId: 'review-link',
    merchantReference: '12345678',
    amount: 100000,
    status: 'PENDING',
    idempotencyKey: crypto.randomUUID(),
    requestFingerprint: 'review',
    expiresAt: group.reservationExpiresAt,
  });
});
const income = async (amount, reference = crypto.randomUUID(), target = payment) => {
  const data = {
    orderCode: Number(target.merchantReference),
    amount,
    currency: 'VND',
    paymentLinkId: target.providerPaymentId,
    reference,
    transactionDateTime: new Date().toISOString(),
    code: '00',
    desc: 'success',
    accountNumber: '99887766',
    description: 'Fixture payment',
  };
  const body = {
    code: '00',
    desc: 'success',
    success: true,
    data,
    signature: await sdk.crypto.createSignatureFromObj(data, sdk.checksumKey),
  };
  return request(app).post('/api/v1/webhooks/payments/payos').send(body);
};
const version = async (target) =>
  (await Payment.findById((target || payment)._id)).reviewVersion || 0;
const decisionBody = async (action, extra = {}, target = payment) => ({
  action,
  note: 'Admin checked verified bank receipts and reviewed the order',
  confirmStock: action === 'ACCEPT_PAYMENT',
  expectedVersion: await version(target),
  idempotencyKey: crypto.randomUUID(),
  ...extra,
});
const decide = async (action, extra = {}, target = payment) =>
  call('post', `/admin/payment-exceptions/${target._id}/decisions`).send(
    await decisionBody(action, extra, target),
  );
const review = async (target = payment, user = admin) =>
  (await call('get', `/payments/${target._id}/review`, user).expect(200)).body.data;
const cancelFixture = async () => {
  await Group.updateOne(
    { _id: group._id },
    { orderStatus: 'CANCELLED', cancelledAt: new Date(), cancellationReason: 'Expired fixture' },
  );
  await Order.updateOne({ _id: order._id }, { orderStatus: 'CANCELLED', cancelledAt: new Date() });
  await Product.updateOne(
    { _id: product._id },
    { $set: { status: 'ACTIVE' }, $unset: { reservationGroupId: 1 } },
  );
};
const readyRefund = async (refund) => {
  const result = await call('put', `/refunds/${refund._id}/bank`, buyer)
    .send({
      bankName: 'BIDV',
      bankBin: '970418',
      accountNumber: '123456789',
      accountName: 'BUYER FIXTURE',
      ownsAccount: true,
    })
    .expect(200);
  await call('post', `/admin/manual-refunds/${refund._id}/approve`)
    .send({ expectedVersion: result.body.data.refund.__v })
    .expect(200);
  await call('post', `/admin/manual-refunds/${refund._id}/proof`)
    .attach('proof', png, 'receipt.png')
    .expect(200);
};
const transferBody = (refund) => ({
  amount: refund.amount,
  reference: `BANK-${crypto.randomUUID()}`,
  transferredAt: new Date().toISOString(),
  note: 'Verified actual outgoing transfer and recipient account',
  transferred: true,
});
const completeRefund = async (refund, data = transferBody(refund)) =>
  call('post', `/admin/manual-refunds/${refund._id}/record-transfer`).send(data);

describe('Payment exception review and allocation', () => {
  it('lists verified receipt totals, paginates and protects buyer/admin access', async () => {
    expect((await income(30000)).status).toBe(200);
    const detail = await review(payment, buyer);
    expect(detail.payment).toMatchObject({
      receivedAmount: 30000,
      allocatedAmount: 0,
      missingAmount: 70000,
      reason: 'UNDERPAID',
      reviewState: 'OPEN',
    });
    expect(detail.receipts).toHaveLength(1);
    await call('get', `/payments/${payment._id}/review`, outsider).expect(404);
    await call('get', `/payments/${payment._id}/review`, seller).expect(404);
    await call('get', '/admin/payment-exceptions', buyer).expect(403);
    const result = await call('get', '/admin/payment-exceptions?limit=1').expect(200);
    expect(result.body.data.pagination.total).toBe(1);
    expect(result.body.data.items[0].receivedAmount).toBe(30000);
    const body = await decisionBody('WAIT_TOPUP');
    await call('post', `/admin/payment-exceptions/${payment._id}/decisions`, buyer)
      .send(body)
      .expect(403);
  });
  it('waits for a top-up, then automatically matches the exact amount while the reservation is valid', async () => {
    expect((await income(30000)).status).toBe(200);
    expect((await decide('WAIT_TOPUP')).status).toBe(200);
    expect((await review()).payment.reviewState).toBe('WAITING_TOPUP');
    expect((await income(70000)).status).toBe(200);
    expect((await Order.findById(order._id)).orderStatus).toBe('PAID');
    expect((await Product.findById(product._id)).status).toBe('SOLD');
    expect((await review()).payment).toMatchObject({
      allocatedAmount: 100000,
      availableAmount: 0,
      reviewState: 'RESOLVED',
      requiresReview: false,
    });
    expect(await Commission.countDocuments()).toBe(1);
    expect(
      await Ledger.countDocuments({ sourceEventKey: `payment:${payment._id}:allocated` }),
    ).toBe(1);
  });
  it('rejects allocating an underpayment and refuses amounts injected into decisions', async () => {
    await income(30000);
    expect((await decide('ACCEPT_PAYMENT')).status).toBe(409);
    await call('post', `/admin/payment-exceptions/${payment._id}/decisions`)
      .send({ ...(await decisionBody('REFUND_UNALLOCATED')), amount: 99999999 })
      .expect(400);
    expect(await Refund.countDocuments()).toBe(0);
    expect(await Commission.countDocuments()).toBe(0);
  });
  it('allocates only the order amount from overpayment and refunds the excess without reducing seller proceeds', async () => {
    await income(120000);
    expect((await decide('ACCEPT_PAYMENT')).status).toBe(200);
    expect((await review()).payment).toMatchObject({
      allocatedAmount: 100000,
      availableAmount: 20000,
      requiresReview: true,
    });
    const result = await decide('REFUND_UNALLOCATED');
    expect(result.status).toBe(200);
    const refund = result.body.data.refund;
    expect(refund).toMatchObject({ kind: 'RECEIPT_ADJUSTMENT', amount: 20000 });
    expect(refund.orderId).toBeUndefined();
    await readyRefund(refund);
    expect((await completeRefund(refund)).status).toBe(200);
    expect((await review()).payment).toMatchObject({
      adjustmentRefundedAmount: 20000,
      availableAmount: 0,
      requiresReview: false,
      reviewState: 'RESOLVED',
    });
    expect((await Order.findById(order._id)).toObject()).toMatchObject({
      orderStatus: 'PAID',
      refundedAmount: 0,
    });
    expect((await Commission.findOne()).toObject()).toMatchObject({
      sellerProceeds: 90000,
      commissionAmount: 10000,
    });
    expect((await Payment.findById(payment._id)).refundedAmount).toBe(0);
    const entry = await Ledger.findOne({ sourceEventKey: `refund:${refund._id}:transferred` });
    expect(entry.lines[0].account).toBe('customer_funds_unallocated');
    expect(entry.lines.reduce((sum, line) => sum + line.debit - line.credit, 0)).toBe(0);
    await call('post', '/admin/manual-refunds')
      .send({
        paymentId: payment.id,
        orderId: order.id,
        amount: 10000,
        reason: 'Separate product refund after surplus resolved',
        idempotencyKey: crypto.randomUUID(),
      })
      .expect(201);
  });
  it('accepts an expired but still-reserved order only after explicit stock confirmation', async () => {
    await Group.updateOne({ _id: group._id }, { reservationExpiresAt: new Date(0) });
    await income(100000);
    expect((await Order.findById(order._id)).paymentStatus).toBe('UNPAID');
    expect((await decide('ACCEPT_PAYMENT', { confirmStock: false })).status).toBe(400);
    expect((await decide('ACCEPT_PAYMENT')).status).toBe(200);
    expect((await Group.findById(group._id)).orderStatus).toBe('PAID');
    expect((await review()).payment.requiresReview).toBe(false);
  });
  it('reclaims a cancelled order only while every product is genuinely available', async () => {
    await cancelFixture();
    await income(100000);
    expect((await decide('ACCEPT_PAYMENT')).status).toBe(200);
    expect((await Order.findById(order._id)).toObject()).toMatchObject({
      paymentStatus: 'PAID',
      orderStatus: 'PAID',
    });
    expect((await Group.findById(group._id)).cancelledAt).toBeUndefined();
    expect((await Product.findById(product._id)).reservationGroupId).toBeUndefined();
    expect((await Action.findOne()).before.cancellationReason).toBe('Expired fixture');
  });
  it('does not steal sold inventory and still refunds the verified late money', async () => {
    await cancelFixture();
    await Order.create({
      ...order.toObject(),
      _id: new mongoose.Types.ObjectId(),
      buyerId: outsider._id,
      checkoutGroupId: new mongoose.Types.ObjectId(),
      orderStatus: 'PAID',
      paymentStatus: 'PAID',
    });
    await Product.updateOne({ _id: product._id }, { status: 'SOLD' });
    await income(100000);
    expect((await decide('ACCEPT_PAYMENT')).status).toBe(409);
    const result = await decide('REFUND_UNALLOCATED');
    expect(result.status).toBe(200);
    await readyRefund(result.body.data.refund);
    expect((await completeRefund(result.body.data.refund)).status).toBe(200);
    expect((await Product.findById(product._id)).status).toBe('SOLD');
    expect(await Commission.countDocuments()).toBe(0);
    expect((await Payment.findById(payment._id)).status).toBe('REFUNDED');
  });
  it('preserves another checkout reservation when cancelling an old cash exception', async () => {
    const another = new mongoose.Types.ObjectId();
    await Product.updateOne({ _id: product._id }, { reservationGroupId: another });
    await Order.create({
      ...order.toObject(),
      _id: new mongoose.Types.ObjectId(),
      buyerId: outsider._id,
      checkoutGroupId: another,
    });
    await income(30000);
    expect((await decide('REFUND_UNALLOCATED')).status).toBe(200);
    const saved = await Product.findById(product._id);
    expect(saved.status).toBe('RESERVED');
    expect(String(saved.reservationGroupId)).toBe(String(another));
    expect((await Group.findById(group._id)).orderStatus).toBe('CANCELLED');
  });
  it('keeps receipt cash durable when the normal webhook finds inventory unavailable', async () => {
    await Product.updateOne({ _id: product._id }, { status: 'SOLD' });
    await income(100000);
    expect(await Receipt.countDocuments()).toBe(1);
    expect((await Payment.findById(payment._id)).metadata.exception).toBe(
      'inventory_requires_review',
    );
    expect(
      await Ledger.countDocuments({ sourceEventKey: `payment:${payment._id}:allocated` }),
    ).toBe(0);
    expect((await Order.findById(order._id)).paymentStatus).toBe('UNPAID');
  });
  it('refunds a second payment for an already-paid group without changing its successful order', async () => {
    await income(100000);
    const second = await Payment.create({
      ...payment.toObject(),
      _id: new mongoose.Types.ObjectId(),
      providerPaymentId: 'second-link',
      merchantReference: '98765432',
      idempotencyKey: crypto.randomUUID(),
    });
    await income(100000, 'SECOND-PAYMENT', second);
    const result = await decide('REFUND_UNALLOCATED', {}, second);
    expect(result.status).toBe(200);
    await readyRefund(result.body.data.refund);
    expect((await completeRefund(result.body.data.refund)).status).toBe(200);
    expect((await Order.findById(order._id)).orderStatus).toBe('PAID');
    expect((await Product.findById(product._id)).status).toBe('SOLD');
    expect(
      await require('../src/services/refundPolicy.service').hasRefundHold(
        await Order.findById(order._id),
      ),
    ).toBe(false);
  });
  it('can return extra receipts after seller payout without clawing back the seller payout', async () => {
    await income(100000);
    const payout = await Payout.create({
      sellerId: seller._id,
      orderIds: [order._id],
      amount: 90000,
      status: 'PAID',
      provider: 'manual',
    });
    await income(15000);
    const result = await decide('REFUND_UNALLOCATED');
    expect(result.status).toBe(200);
    expect(result.body.data.refund.amount).toBe(15000);
    await readyRefund(result.body.data.refund);
    expect((await completeRefund(result.body.data.refund)).status).toBe(200);
    expect((await Payout.findById(payout._id)).toObject()).toMatchObject({
      amount: 90000,
      status: 'PAID',
    });
  });
  it('rejects stale decisions when new bank receipts arrive', async () => {
    await income(30000);
    const data = await decisionBody('WAIT_TOPUP');
    await income(10000);
    await call('post', `/admin/payment-exceptions/${payment._id}/decisions`).send(data).expect(409);
    expect(await Action.countDocuments()).toBe(0);
  });
  it('serializes conflicting admin decisions and never both allocates and reserves the same cash', async () => {
    await income(120000);
    const a = await decisionBody('ACCEPT_PAYMENT');
    const b = await decisionBody('REFUND_UNALLOCATED');
    const results = await Promise.all([
      call('post', `/admin/payment-exceptions/${payment._id}/decisions`).send(a),
      call('post', `/admin/payment-exceptions/${payment._id}/decisions`).send(b),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(await Action.countDocuments()).toBe(1);
    const balance = (await review()).payment;
    expect(balance.allocatedAmount + balance.adjustmentReservedAmount).toBeLessThanOrEqual(120000);
  });
  it('makes decision and bank-confirmation retries idempotent and rejects changed payloads', async () => {
    await income(30000);
    const data = await decisionBody('REFUND_UNALLOCATED');
    const first = await call('post', `/admin/payment-exceptions/${payment._id}/decisions`)
      .send(data)
      .expect(200);
    const retry = await call('post', `/admin/payment-exceptions/${payment._id}/decisions`)
      .send(data)
      .expect(200);
    expect(retry.body.data.refund._id).toBe(first.body.data.refund._id);
    await call('post', `/admin/payment-exceptions/${payment._id}/decisions`)
      .send({ ...data, note: 'Changed decision note' })
      .expect(409);
    const refund = first.body.data.refund;
    await readyRefund(refund);
    const transfer = transferBody(refund);
    expect((await completeRefund(refund, transfer)).status).toBe(200);
    expect((await completeRefund(refund, transfer)).status).toBe(200);
    expect((await Payment.findById(payment._id)).exceptionRefundedAmount).toBe(30000);
    expect(
      await Ledger.countDocuments({ sourceEventKey: `refund:${refund._id}:transferred` }),
    ).toBe(1);
  });
  it('reopens review when another receipt arrives after a completed cash return', async () => {
    await income(30000);
    const result = await decide('REFUND_UNALLOCATED');
    const refund = result.body.data.refund;
    await readyRefund(refund);
    expect((await completeRefund(refund)).status).toBe(200);
    await income(10000);
    const balance = (await review()).payment;
    expect(balance).toMatchObject({
      reviewState: 'OPEN',
      receivedAmount: 40000,
      adjustmentRefundedAmount: 30000,
      availableAmount: 10000,
    });
    expect((await Group.findById(group._id)).orderStatus).toBe('CANCELLED');
  });
  it('does not auto-allocate top-up money while an earlier cash return is pending', async () => {
    await income(30000);
    const result = await decide('REFUND_UNALLOCATED');
    await income(70000);
    expect((await Group.findById(group._id)).orderStatus).toBe('CANCELLED');
    expect(await Commission.countDocuments()).toBe(0);
    await readyRefund(result.body.data.refund);
    expect((await completeRefund(result.body.data.refund)).status).toBe(200);
    expect((await review()).payment).toMatchObject({
      availableAmount: 70000,
      adjustmentRefundedAmount: 30000,
      reviewState: 'OPEN',
    });
  });
  it('releases a cancelled refund reservation but does not silently restore cancelled orders', async () => {
    await income(30000);
    const result = await decide('REFUND_UNALLOCATED');
    await call('post', `/admin/manual-refunds/${result.body.data.refund._id}/cancel`)
      .send({ note: 'Cancel refund request pending further review' })
      .expect(200);
    expect((await review()).payment).toMatchObject({
      availableAmount: 30000,
      adjustmentReservedAmount: 0,
      reviewState: 'OPEN',
    });
    expect((await Group.findById(group._id)).orderStatus).toBe('CANCELLED');
    expect(await Ledger.countDocuments({ sourceType: 'REFUND' })).toBe(0);
  });
  it('rolls back refund creation, stock release and history if outbox storage fails', async () => {
    await income(30000);
    const initialVersion = await version();
    jest
      .spyOn(events, 'enqueueNotificationEvent')
      .mockRejectedValueOnce(new Error('Outbox unavailable'));
    expect((await decide('REFUND_UNALLOCATED')).status).toBe(500);
    expect(await Refund.countDocuments()).toBe(0);
    expect(await Action.countDocuments()).toBe(0);
    expect((await Product.findById(product._id)).status).toBe('RESERVED');
    expect(await version()).toBe(initialVersion);
  });
  it('rolls back the cash refund transfer and shared bank reference on a notification failure', async () => {
    await income(30000);
    const result = await decide('REFUND_UNALLOCATED');
    const refund = result.body.data.refund;
    await readyRefund(refund);
    jest
      .spyOn(events, 'enqueueNotificationEvent')
      .mockRejectedValueOnce(new Error('Outbox unavailable'));
    const data = transferBody(refund);
    expect((await completeRefund(refund, data)).status).toBe(500);
    expect((await Payment.findById(payment._id)).exceptionRefundedAmount).toBe(0);
    expect((await Refund.findById(refund._id)).status).toBe('APPROVED');
    expect(await require('../src/models/outgoingBankTransfer.model').countDocuments()).toBe(0);
    expect((await completeRefund(refund, data)).status).toBe(200);
  });
  it('prevents direct buyer cancellation once a bank receipt exists', async () => {
    await income(30000);
    await call('post', `/orders/${order._id}/cancel`, buyer).send({}).expect(409);
    expect((await Product.findById(product._id)).status).toBe('RESERVED');
  });
  it('rechecks PayOS through the verified query path and throttles repeated rechecks', async () => {
    await income(30000, 'FIRST-RECEIPT');
    sdk.paymentRequests.get.mockResolvedValue({
      orderCode: Number(payment.merchantReference),
      id: payment.providerPaymentId,
      amount: 100000,
      amountPaid: 120000,
      status: 'PAID',
      transactions: [
        {
          reference: 'FIRST-RECEIPT',
          amount: 30000,
          transactionDateTime: new Date().toISOString(),
        },
        {
          reference: 'QUERY-SECOND-RECEIPT',
          amount: 90000,
          transactionDateTime: new Date().toISOString(),
        },
      ],
    });
    await call('post', `/admin/payment-exceptions/${payment._id}/recheck`).expect(200);
    expect(await Receipt.countDocuments()).toBe(2);
    expect((await review()).payment.receivedAmount).toBe(120000);
    await call('post', `/admin/payment-exceptions/${payment._id}/recheck`).expect(429);
    expect(await Action.countDocuments({ action: 'PROVIDER_RECHECK' })).toBe(1);
  });
  it('keeps recorded money unchanged during a failed provider query', async () => {
    await income(30000);
    await call('post', `/admin/payment-exceptions/${payment._id}/recheck`).expect(502);
    expect((await review()).payment.receivedAmount).toBe(30000);
    expect(await Receipt.countDocuments()).toBe(1);
  });
  it('does not accept an invalid webhook signature into the review queue', async () => {
    await request(app)
      .post('/api/v1/webhooks/payments/payos')
      .send({ data: { amount: 100000 }, signature: 'invalid' })
      .expect(401);
    expect(await Receipt.countDocuments()).toBe(0);
    expect(
      (await call('get', '/admin/payment-exceptions').expect(200)).body.data.pagination.total,
    ).toBe(0);
  });
  it('races correctly against a new checkout for released inventory', async () => {
    await cancelFixture();
    await income(100000);
    await require('../src/models/cart.model').create({
      userId: outsider._id,
      items: [{ productId: product._id, addedAt: new Date() }],
    });
    const results = await Promise.all([
      decide('ACCEPT_PAYMENT'),
      call('post', '/orders', outsider).send({
        shippingAddress: address,
        idempotencyKey: crypto.randomUUID(),
      }),
    ]);
    expect(results.filter((result) => result.status < 300)).toHaveLength(1);
    expect(results.find((result) => result.status >= 300).status).toBe(409);
    expect(await Receipt.countDocuments()).toBe(1);
  });
  it('serializes automatic top-up allocation against a conflicting refund decision', async () => {
    await income(30000);
    const body = await decisionBody('REFUND_UNALLOCATED');
    await Promise.all([
      income(70000),
      call('post', `/admin/payment-exceptions/${payment._id}/decisions`).send(body),
    ]);
    const detail = await review();
    expect(
      detail.payment.allocatedAmount + detail.payment.adjustmentReservedAmount,
    ).toBeLessThanOrEqual(100000);
    if (detail.payment.allocatedAmount) {
      expect(detail.payment.adjustmentReservedAmount).toBe(0);
      expect((await Product.findById(product._id)).status).toBe('SOLD');
    } else expect((await Group.findById(group._id)).orderStatus).toBe('CANCELLED');
  });
});
