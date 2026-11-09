const crypto = require('node:crypto');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const app = require('../src/app');
const User = require('../src/models/user.model');
const Shop = require('../src/models/sellerProfile.model');
const Payment = require('../src/models/payment.model');
const Receipt = require('../src/models/paymentTransaction.model');
const Order = require('../src/models/order.model');
const Group = require('../src/models/checkoutGroup.model');
const Commission = require('../src/models/commission.model');
const Refund = require('../src/models/refund.model');
const Payout = require('../src/models/sellerPayout.model');
const Ledger = require('../src/models/ledgerEntry.model');
const Dispute = require('../src/models/dispute.model');
const Transfer = require('../src/models/outgoingBankTransfer.model');
const Proof = require('../src/models/refundProof.model');
const events = require('../src/services/notificationEvent.service');
const settlements = require('../src/services/settlementEligibility.service');
const { signAccessToken } = require('../src/utils/token');
const { apiLimiter } = require('../src/middlewares/rateLimit.middleware');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);
const bank = {
  bankName: 'BIDV',
  bankBin: '970418',
  accountNumber: '123456789',
  accountName: 'Buyer Fixture',
  ownsAccount: true,
};
let mongo, buyer, seller, seller2, admin, outsider, payment, orders;
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
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  jest.restoreAllMocks();
  apiLimiter.resetKey('127.0.0.1');
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
  [buyer, seller, seller2, admin, outsider] = await User.create(
    ['BUYER', 'SELLER', 'SELLER', 'ADMIN', 'BUYER'].map((role, i) => ({
      role,
      fullName: `Fixture ${i}`,
      email: `fixture${i}@example.test`,
      passwordHash: 'fixture',
    })),
  );
  await Shop.create(
    [seller, seller2].map((user, i) => ({
      userId: user._id,
      shopName: `Fixture shop ${i}`,
      shopSlug: `fixture-${i}`,
      verificationStatus: 'VERIFIED',
    })),
  );
  const past = new Date(Date.now() - 30 * 86400000);
  const group = await Group.create({
    buyerId: buyer._id,
    idempotencyKey: crypto.randomUUID(),
    requestFingerprint: 'fixture',
    subtotal: 300000,
    buyerTotal: 300000,
    paymentStatus: 'PAID',
    orderStatus: 'COMPLETED',
    reservationExpiresAt: past,
  });
  orders = await Order.create(
    [seller, seller2].map((user, i) => ({
      checkoutGroupId: group._id,
      buyerId: buyer._id,
      sellerId: user._id,
      items: [
        {
          productId: new mongoose.Types.ObjectId(),
          title: `Garment ${i}`,
          price: (i + 1) * 100000,
          quantity: 1,
        },
      ],
      shippingAddress: {
        recipientName: 'Buyer',
        phone: '0901234567',
        addressLine: 'Street',
        ward: 'Ward',
        city: 'City',
      },
      subtotal: (i + 1) * 100000,
      buyerTotal: (i + 1) * 100000,
      commissionRateBasisPoints: 1000,
      commissionAmount: (i + 1) * 10000,
      sellerProceeds: (i + 1) * 90000,
      paymentStatus: 'PAID',
      orderStatus: 'COMPLETED',
      deliveredAt: past,
      protectionEndsAt: past,
      completedAt: past,
      completedBy: admin._id,
      reservationExpiresAt: past,
    })),
  );
  await Commission.create(
    orders.map((order) => ({
      orderId: order._id,
      sellerId: order.sellerId,
      subtotal: order.subtotal,
      commissionRateBasisPoints: 1000,
      commissionAmount: order.commissionAmount,
      sellerProceeds: order.sellerProceeds,
    })),
  );
  payment = await Payment.create({
    checkoutGroupId: group._id,
    buyerId: buyer._id,
    provider: 'payos',
    providerPaymentId: crypto.randomUUID(),
    merchantReference: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    requestFingerprint: 'fixture',
    amount: 300000,
    status: 'SUCCEEDED',
    paidAt: past,
    expiresAt: past,
  });
  await Receipt.create({
    provider: 'payos',
    paymentId: payment._id,
    checkoutGroupId: group._id,
    providerPaymentId: payment.providerPaymentId,
    merchantReference: payment.merchantReference,
    reference: 'INCOMING-12345',
    amount: 300000,
    currency: 'VND',
    occurredAt: past,
    status: 'MATCHED',
    source: 'WEBHOOK',
  });
});
const body = (amount = 50000, order = orders[0]) => ({
  paymentId: payment.id,
  orderId: order.id,
  amount,
  idempotencyKey: crypto.randomUUID(),
  reason: 'Admin approved buyer refund after review',
});
const create = async (data = body()) =>
  (await call('post', '/admin/manual-refunds').send(data).expect(201)).body.data.refund;
const approveRefund = async (refund) =>
  call('post', `/admin/manual-refunds/${refund._id}/approve`).send({
    expectedVersion: (await Refund.findById(refund._id)).__v,
  });
const ready = async (refund) => {
  await call('put', `/refunds/${refund._id}/bank`, buyer).send(bank).expect(200);
  expect((await approveRefund(refund)).status).toBe(200);
  await call('post', `/admin/manual-refunds/${refund._id}/proof`)
    .attach('proof', png, 'receipt.png')
    .expect(200);
};
const transferBody = (refund) => ({
  amount: refund.amount,
  reference: `OUT-${crypto.randomUUID()}`,
  transferredAt: new Date().toISOString(),
  note: 'Verified bank receipt and recipient account',
  transferred: true,
});
const finish = async (refund, data = transferBody(refund)) =>
  (await call('post', `/admin/manual-refunds/${refund._id}/record-transfer`).send(data).expect(200))
    .body.data.refund;

describe('Manual PayOS refund workflow', () => {
  it('rejects stale admin approval after the buyer changes their receiving account', async () => {
    const refund = await create();
    const first = await call('put', `/refunds/${refund._id}/bank`, buyer).send(bank).expect(200);
    await call('put', `/refunds/${refund._id}/bank`, buyer)
      .send({ ...bank, accountNumber: '987654321' })
      .expect(200);
    await call('post', `/admin/manual-refunds/${refund._id}/approve`)
      .send({ expectedVersion: first.body.data.refund.__v })
      .expect(409);
    expect((await Refund.findById(refund._id)).status).toBe('PENDING');
    expect((await approveRefund(refund)).status).toBe(200);
    expect((await Refund.findById(refund._id)).bankSnapshot.accountNumber).toBe('987654321');
  });
  it('lets admin request corrected bank details only before any transfer proof exists', async () => {
    const refund = await create();
    await call('put', `/refunds/${refund._id}/bank`, buyer).send(bank).expect(200);
    expect((await approveRefund(refund)).status).toBe(200);
    const path = `/admin/manual-refunds/${refund._id}/request-bank-correction`;
    await call('post', path)
      .send({ note: 'Please correct the account holder', notTransferred: false })
      .expect(400);
    await call('post', path)
      .send({ note: 'Please correct the account holder', notTransferred: true })
      .expect(200);
    expect((await Refund.findById(refund._id)).status).toBe('REQUESTED');
    await ready(refund);
    await call('post', path)
      .send({ note: 'Cannot edit after transfer proof', notTransferred: true })
      .expect(409);
  });
  it('rejects oversized proof, future transfer time and wrong transferred amount without changing funds', async () => {
    const refund = await create();
    await ready(refund);
    await call('post', `/admin/manual-refunds/${refund._id}/proof`)
      .attach('proof', Buffer.alloc(5 * 1024 * 1024 + 1), 'receipt.png')
      .expect(413);
    const path = `/admin/manual-refunds/${refund._id}/record-transfer`;
    await call('post', path)
      .send({
        ...transferBody(refund),
        transferredAt: new Date(Date.now() + 3600000).toISOString(),
      })
      .expect(400);
    await call('post', path)
      .send({ ...transferBody(refund), amount: refund.amount + 1 })
      .expect(409);
    await call('post', path)
      .send({ ...transferBody(refund), transferred: false })
      .expect(400);
    expect((await Payment.findById(payment._id)).refundedAmount).toBe(0);
  });
  it('allows payout of the remaining proceeds after a partial refund', async () => {
    await settlements.evaluateEligibleOrders();
    const refund = await create();
    await ready(refund);
    const data = transferBody(refund);
    await finish(refund, data);
    await call('post', '/admin/manual-refunds').send(body(50001)).expect(409);
    const payout = await Payout.findOne({ orderIds: orders[0]._id });
    payout.provider = 'manual';
    await payout.save();
    await require('../src/models/sellerBankAccount.model').create({
      sellerId: seller._id,
      bankName: bank.bankName,
      bankBin: bank.bankBin,
      accountNumber: bank.accountNumber,
      accountName: 'SELLER FIXTURE',
    });
    const workflow = require('../src/services/marketplaceWorkflow.service');
    await require('./helpers/verifiedSeller')(seller._id);
    await workflow.approveManualPayout(admin, payout._id);
    await expect(
      workflow.recordManualPayout(admin, payout._id, {
        amount: 45000,
        reference: data.reference,
        note: 'Same transfer reference must be rejected',
        transferred: true,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await workflow.recordManualPayout(admin, payout._id, {
      amount: 45000,
      reference: 'PAYOUT-UNIQUE-12345',
      note: 'Net proceeds verified and transferred',
      transferred: true,
    });
    expect((await Payout.findById(payout._id)).status).toBe('PAID');
    expect(await Transfer.countDocuments()).toBe(2);
  });
  it('reserves funds without recording money as refunded, and isolates the other shop', async () => {
    const refund = await create();
    expect(refund.status).toBe('REQUESTED');
    expect((await Payment.findById(payment._id)).refundedAmount).toBe(0);
    expect((await Payment.findById(payment._id)).refundReservedAmount).toBe(50000);
    expect((await Order.findById(orders[0]._id)).paymentStatus).toBe('REFUND_PENDING');
    expect((await Order.findById(orders[1]._id)).paymentStatus).toBe('PAID');
    expect(
      (await settlements.explainEligibility(await Order.findById(orders[1]._id))).eligible,
    ).toBe(true);
    expect(
      (await settlements.explainEligibility(await Order.findById(orders[0]._id))).eligible,
    ).toBe(false);
    expect(await Ledger.countDocuments()).toBe(0);
  });
  it('enforces roles, ownership, bank confirmation and frozen recipient after approval', async () => {
    await call('post', '/admin/manual-refunds', buyer).send(body()).expect(403);
    const refund = await create();
    await call('get', `/refunds/${refund._id}`, outsider).expect(404);
    await call('get', `/refunds/${refund._id}`, seller).expect(403);
    await call('put', `/refunds/${refund._id}/bank`, outsider).send(bank).expect(404);
    await call('put', `/refunds/${refund._id}/bank`, buyer)
      .send({ ...bank, ownsAccount: false })
      .expect(400);
    expect((await approveRefund(refund)).status).toBe(409);
    await ready(refund);
    await call('put', `/refunds/${refund._id}/bank`, buyer)
      .send({ ...bank, accountNumber: '99999999' })
      .expect(409);
    const saved = await Refund.findById(refund._id);
    expect(saved.bankSnapshot.accountNumber).toBe(bank.accountNumber);
    expect(saved.bankSnapshot.accountName).toBe(bank.accountName.toUpperCase());
    expect((await call('get', '/refunds', outsider).expect(200)).body.data.items).toHaveLength(0);
  });
  it('completes a partial refund once and adjusts the existing eligible payout and balanced ledger', async () => {
    await settlements.evaluateEligibleOrders();
    const payout = await Payout.findOne({ orderIds: orders[0]._id });
    const refund = await create();
    await ready(refund);
    const data = transferBody(refund);
    await finish(refund, data);
    await finish(refund, data);
    expect((await Payment.findById(payment._id)).toObject()).toMatchObject({
      status: 'PARTIALLY_REFUNDED',
      refundedAmount: 50000,
      refundReservedAmount: 0,
    });
    expect((await Order.findById(orders[0]._id)).toObject()).toMatchObject({
      paymentStatus: 'PAID',
      refundedAmount: 50000,
    });
    expect((await Payout.findById(payout._id)).amount).toBe(45000);
    expect((await Commission.findOne({ orderId: orders[0]._id })).toObject()).toMatchObject({
      sellerProceeds: 45000,
      commissionAmount: 5000,
    });
    expect(await Transfer.countDocuments()).toBe(1);
    expect(await Ledger.countDocuments()).toBe(1);
    const entry = await Ledger.findOne();
    expect(entry.lines.reduce((sum, line) => sum + line.debit - line.credit, 0)).toBe(0);
    await call('post', `/admin/manual-refunds/${refund._id}/record-transfer`)
      .send({ ...data, amount: 1 })
      .expect(409);
    await call('get', `/refunds/${refund._id}/proof`, buyer)
      .expect('Cache-Control', 'private, no-store')
      .expect(200);
    await events.processBatch({ limit: 50 });
    expect(
      await require('../src/models/notification.model').countDocuments({
        recipientId: buyer._id,
        type: 'REFUND_UPDATED',
      }),
    ).toBeGreaterThan(0);
  });
  it('links buyer dispute resolution to completed refund and fully reverses an order without holding other sellers', async () => {
    const dispute = await Dispute.create({
      orderId: orders[0]._id,
      buyerId: buyer._id,
      sellerId: seller._id,
      reason: 'DAMAGED_ITEM',
      description: 'Verified damage',
      status: 'RESOLVED_BUYER',
    });
    const refund = await create({ ...body(100000), disputeId: dispute.id });
    await ready(refund);
    await finish(refund);
    expect((await Order.findById(orders[0]._id)).orderStatus).toBe('REFUNDED');
    expect((await Commission.findOne({ orderId: orders[0]._id })).status).toBe('REVERSED');
    expect((await Dispute.findById(dispute._id)).refundSettledAt).toBeTruthy();
    expect(
      (await settlements.explainEligibility(await Order.findById(orders[1]._id))).eligible,
    ).toBe(true);
    const refund2 = await create(body(200000, orders[1]));
    await ready(refund2);
    await finish(refund2);
    expect((await Payment.findById(payment._id)).status).toBe('REFUNDED');
    expect((await Group.findById(payment.checkoutGroupId)).paymentStatus).toBe('REFUNDED');
  });
  it('rejects over-refunds, invalid order/payment associations and missing receipt reconciliation', async () => {
    await call('post', '/admin/manual-refunds').send(body(100001)).expect(409);
    await call('post', '/admin/manual-refunds')
      .send({ ...body(), orderId: new mongoose.Types.ObjectId().toString() })
      .expect(409);
    await Receipt.updateOne({ paymentId: payment._id }, { amount: 299999 });
    await call('post', '/admin/manual-refunds').send(body()).expect(409);
    expect(await Refund.countDocuments()).toBe(0);
  });
  it('allows a retry with the same key and rejects changed payloads and overlapping refunds', async () => {
    const data = body();
    const refund = await create(data);
    const retry = await create(data);
    expect(retry._id).toBe(refund._id);
    await call('post', '/admin/manual-refunds')
      .send({ ...data, amount: 30000 })
      .expect(409);
    await call('post', '/admin/manual-refunds').send(body()).expect(409);
    expect((await Payment.findById(payment._id)).refundReservedAmount).toBe(50000);
  });
  it('serializes competing creations for the same order and concurrent idempotent confirmations', async () => {
    const results = await Promise.all([
      call('post', '/admin/manual-refunds').send(body(60000)),
      call('post', '/admin/manual-refunds').send(body(60000)),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const refund = results.find((result) => result.status === 201).body.data.refund;
    await ready(refund);
    const data = transferBody(refund);
    await Promise.all([finish(refund, data), finish(refund, data)]);
    expect(await Ledger.countDocuments()).toBe(1);
    expect(await Transfer.countDocuments()).toBe(1);
  });
  it('keeps cancelled refunds out of money totals and prevents cancelling an approved transfer', async () => {
    const refund = await create();
    await call('post', `/admin/manual-refunds/${refund._id}/cancel`)
      .send({ note: 'Buyer and admin agreed to cancel request' })
      .expect(200);
    expect((await Payment.findById(payment._id)).refundReservedAmount).toBe(0);
    expect((await Order.findById(orders[0]._id)).paymentStatus).toBe('PAID');
    const next = await create();
    await ready(next);
    await call('post', `/admin/manual-refunds/${next._id}/cancel`)
      .send({ note: 'Cannot cancel after approval' })
      .expect(409);
  });
  it('requires private proof, checks file contents and forbids access by unrelated accounts', async () => {
    const refund = await create();
    await call('post', `/admin/manual-refunds/${refund._id}/proof`, buyer)
      .attach('proof', png, 'receipt.png')
      .expect(403);
    await call('put', `/refunds/${refund._id}/bank`, buyer).send(bank).expect(200);
    expect((await approveRefund(refund)).status).toBe(200);
    await call('post', `/admin/manual-refunds/${refund._id}/record-transfer`)
      .send(transferBody(refund))
      .expect(409);
    await call('post', `/admin/manual-refunds/${refund._id}/proof`)
      .attach('proof', Buffer.from('<html>fake</html>'), 'receipt.png')
      .expect(415);
    await call('post', `/admin/manual-refunds/${refund._id}/proof`)
      .attach('proof', png, 'receipt.png')
      .expect(200);
    await call('post', `/admin/manual-refunds/${refund._id}/proof`)
      .attach('proof', png, 'receipt.png')
      .expect(200);
    await call('get', `/refunds/${refund._id}/proof`, buyer).expect(404);
    await call('get', `/refunds/${refund._id}/proof`, outsider).expect(404);
    expect(await Proof.countDocuments()).toBe(1);
  });
  it.each(['APPROVED', 'PROCESSING', 'PAID'])(
    'blocks refund after seller payout is %s',
    async (status) => {
      await Payout.create({
        sellerId: seller._id,
        orderIds: [orders[0]._id],
        amount: 90000,
        provider: 'manual',
        status,
      });
      await call('post', '/admin/manual-refunds').send(body()).expect(409);
    },
  );
  it('prevents duplicate outgoing bank references across refunds', async () => {
    const first = await create();
    await ready(first);
    const data = transferBody(first);
    await finish(first, data);
    const second = await create(body(10000));
    await ready(second);
    await call('post', `/admin/manual-refunds/${second._id}/record-transfer`)
      .send({ ...transferBody(second), reference: data.reference.toLowerCase() })
      .expect(409);
    expect((await Payment.findById(payment._id)).refundedAmount).toBe(50000);
  });
  it('rolls back every financial mutation if writing the notification fails', async () => {
    const refund = await create();
    await ready(refund);
    jest
      .spyOn(events, 'enqueueNotificationEvent')
      .mockRejectedValueOnce(new Error('Outbox unavailable'));
    await call('post', `/admin/manual-refunds/${refund._id}/record-transfer`)
      .send(transferBody(refund))
      .expect(500);
    expect((await Refund.findById(refund._id)).status).toBe('APPROVED');
    expect((await Payment.findById(payment._id)).refundedAmount).toBe(0);
    expect((await Commission.findOne({ orderId: orders[0]._id })).sellerProceeds).toBe(90000);
    expect(await Ledger.countDocuments()).toBe(0);
    expect(await Transfer.countDocuments()).toBe(0);
    await finish(refund);
  });
  it('serializes payout approval versus refund creation, allowing only one financial path', async () => {
    await settlements.evaluateEligibleOrders();
    const payout = await Payout.findOne({ orderIds: orders[0]._id });
    const results = await Promise.allSettled([
      require('../src/services/payout.service').approvePayout(payout._id),
      require('../src/services/manualRefund.service').create(admin, body()),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });
  it('uses cumulative integer allocation so 1 VND partial refunds cannot corrupt rounding', async () => {
    for (const amount of [1, 9, 99990]) {
      const refund = await create(body(amount));
      await ready(refund);
      await finish(refund);
    }
    const commission = await Commission.findOne({ orderId: orders[0]._id });
    expect(commission.sellerProceeds).toBe(0);
    expect(commission.commissionAmount).toBe(0);
    expect((await Order.findById(orders[0]._id)).refundedAmount).toBe(100000);
  });
  it('keeps legacy refunds as a group hold and does not allow unrelated admins to self-approve', async () => {
    await Payment.updateOne(
      { _id: payment._id },
      { refundedAmount: 1, status: 'PARTIALLY_REFUNDED' },
    );
    expect(
      (await settlements.explainEligibility(await Order.findById(orders[1]._id))).eligible,
    ).toBe(false);
    await Payment.updateOne({ _id: payment._id }, { refundedAmount: 0, status: 'SUCCEEDED' });
    await Order.updateOne({ _id: orders[0]._id }, { buyerId: admin._id });
    await Payment.updateOne({ _id: payment._id }, { buyerId: admin._id });
    await call('post', '/admin/manual-refunds').send(body()).expect(403);
  });
});
