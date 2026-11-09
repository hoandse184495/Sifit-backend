const crypto = require('node:crypto');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const app = require('../src/app');
const User = require('../src/models/user.model');
const Order = require('../src/models/order.model');
const Dispute = require('../src/models/dispute.model');
const Evidence = require('../src/models/disputeEvidence.model');
const Message = require('../src/models/disputeMessage.model');
const Payment = require('../src/models/payment.model');
const Group = require('../src/models/checkoutGroup.model');
const Commission = require('../src/models/commission.model');
const Refund = require('../src/models/refund.model');
const events = require('../src/services/notificationEvent.service');
const { signAccessToken } = require('../src/utils/token');
const { apiLimiter } = require('../src/middlewares/rateLimit.middleware');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);
let mongo, buyer, seller, admin, outsider, order, dispute, payment;
const call = (method, path, user = buyer) => {
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
  [buyer, seller, admin, outsider] = await User.create(
    ['BUYER', 'SELLER', 'ADMIN', 'BUYER'].map((role, i) => ({
      fullName: `Case fixture ${i}`,
      email: `case${i}@example.test`,
      passwordHash: 'fixture',
      role,
    })),
  );
  const past = new Date(Date.now() - 86400000);
  const group = await Group.create({
    buyerId: buyer._id,
    idempotencyKey: crypto.randomUUID(),
    requestFingerprint: 'case',
    subtotal: 100000,
    buyerTotal: 100000,
    orderStatus: 'DELIVERED',
    paymentStatus: 'PAID',
    reservationExpiresAt: past,
  });
  order = await Order.create({
    buyerId: buyer._id,
    sellerId: seller._id,
    checkoutGroupId: group._id,
    items: [
      {
        productId: new mongoose.Types.ObjectId(),
        title: 'Fixture jacket',
        price: 100000,
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
    subtotal: 100000,
    buyerTotal: 100000,
    commissionRateBasisPoints: 1000,
    commissionAmount: 10000,
    sellerProceeds: 90000,
    paymentStatus: 'PAID',
    orderStatus: 'DELIVERED',
    deliveredAt: past,
    reservationExpiresAt: past,
    protectionEndsAt: new Date(Date.now() + 86400000),
  });
  payment = await Payment.create({
    checkoutGroupId: group._id,
    buyerId: buyer._id,
    provider: 'payos',
    providerPaymentId: crypto.randomUUID(),
    merchantReference: crypto.randomUUID(),
    amount: 100000,
    status: 'SUCCEEDED',
    paidAt: past,
    expiresAt: past,
    idempotencyKey: crypto.randomUUID(),
    requestFingerprint: 'case',
  });
  await require('../src/models/paymentTransaction.model').create({
    paymentId: payment._id,
    checkoutGroupId: group._id,
    provider: 'payos',
    providerPaymentId: payment.providerPaymentId,
    merchantReference: payment.merchantReference,
    reference: 'CASE-INCOMING-12345',
    amount: 100000,
    currency: 'VND',
    occurredAt: past,
    status: 'MATCHED',
    source: 'WEBHOOK',
  });
  await Commission.create({
    orderId: order._id,
    sellerId: seller._id,
    subtotal: 100000,
    commissionRateBasisPoints: 1000,
    commissionAmount: 10000,
    sellerProceeds: 90000,
  });
  dispute = await Dispute.create({
    orderId: order._id,
    buyerId: buyer._id,
    sellerId: seller._id,
    reason: 'DAMAGED_ITEM',
    description: 'The garment arrived with damage.',
  });
});
const version = async () => (await Dispute.findById(dispute._id)).contentVersion || 0;
const path = (suffix) => `/disputes/${dispute._id}/${suffix}`;
const resolve = async (data = {}) =>
  call('patch', `/admin/disputes/${dispute._id}/resolve`, admin).send({
    status: 'RESOLVED_BUYER',
    resolution: 'Buyer evidence accepted after review',
    expectedVersion: await version(),
    ...data,
  });
const requireReturn = async () =>
  resolve({
    returnRequired: true,
    returnDetails: {
      address: {
        recipientName: 'Seller Fixture',
        phone: '0901234567',
        addressLine: '123 Test Street',
        ward: 'Test Ward',
        province: 'Test City',
      },
      instructions: 'Pack the garment and include all original accessories.',
      shippingPayer: 'SELLER',
      shipBy: new Date(Date.now() + 7 * 86400000).toISOString(),
    },
  });
const upload = (
  user = buyer,
  category = 'GENERAL',
  buffer = png,
  caption = 'Fixture evidence caption',
) =>
  call('post', path('evidence'), user)
    .field('caption', caption)
    .field('category', category)
    .attach('evidence', buffer, 'proof.png');
const shipment = async (data = {}) =>
  call('post', path('return-shipment')).send({
    expectedVersion: await version(),
    carrierName: 'Fixture Carrier',
    trackingNumber: 'RETURN-123456',
    shippedAt: new Date().toISOString(),
    note: 'Parcel handed to return carrier',
    ...data,
  });
const receipt = async (data = {}, user = seller) =>
  call('post', path('return-receipt'), user).send({
    expectedVersion: await version(),
    note: 'Received and inspected the returned garment',
    ...data,
  });
const verify = async (data = {}, user = admin) =>
  call('post', `/admin/disputes/${dispute._id}/verify-return`, user).send({
    expectedVersion: await version(),
    note: 'Verified tracking and seller receipt',
    overrideSellerConfirmation: false,
    ...data,
  });
const refundBody = () => ({
  paymentId: payment.id,
  orderId: order.id,
  disputeId: dispute.id,
  amount: 50000,
  reason: 'Refund after reviewing damage and return',
  idempotencyKey: crypto.randomUUID(),
});

describe('Private dispute evidence and replies', () => {
  it('shares evidence only with case parties/admin and never embeds image bytes in JSON', async () => {
    const created = await upload().expect(201);
    const file = created.body.data.evidence;
    expect(file.data).toBeUndefined();
    expect(file.mimeType).toBe('image/png');
    for (const user of [buyer, seller, admin]) {
      const list = await call('get', path('evidence'), user).expect(200);
      expect(list.body.data.items).toHaveLength(1);
      expect(list.body.data.items[0].data).toBeUndefined();
      const binary = await call('get', path(`evidence/${file._id}`), user)
        .expect('Cache-Control', 'private, no-store')
        .expect(200);
      expect(binary.body.equals(png)).toBe(true);
    }
    await call('get', path('evidence'), outsider).expect(404);
    await call('get', path(`evidence/${file._id}`), outsider).expect(404);
    await upload(outsider).expect(404);
    await request(app)
      .get(`/api/v1${path(`evidence/${file._id}`)}`)
      .expect(401);
  });
  it('validates real image headers, size, caption and multipart field count', async () => {
    await upload(buyer, 'GENERAL', Buffer.from('<html>not an image</html>')).expect(415);
    await upload(buyer, 'GENERAL', Buffer.alloc(5 * 1024 * 1024 + 1)).expect(413);
    await upload(buyer, 'GENERAL', png, 'x').expect(400);
    await call('post', path('evidence'))
      .field('caption', 'Valid caption')
      .attach('wrong', png, 'proof.png')
      .expect(400);
    expect(await Evidence.countDocuments()).toBe(0);
  });
  it('deduplicates retried uploads and prevents reusing an image with changed provenance', async () => {
    const first = await upload().expect(201);
    const retry = await upload().expect(201);
    expect(retry.body.data.evidence._id).toBe(first.body.data.evidence._id);
    await upload(buyer, 'GENERAL', png, 'Changed caption').expect(409);
    await upload(seller).expect(201);
    expect(await Evidence.countDocuments()).toBe(2);
    expect((await Dispute.findById(dispute._id)).evidenceCount).toBe(2);
  });
  it('enforces per-party attachment limits atomically', async () => {
    for (let i = 0; i < 10; i += 1)
      await upload(buyer, 'GENERAL', Buffer.concat([png, Buffer.from(String(i))])).expect(201);
    await upload(buyer, 'GENERAL', Buffer.concat([png, Buffer.from('extra')])).expect(429);
    await upload(seller).expect(201);
    expect(await Evidence.countDocuments()).toBe(11);
  });
  it('persists buyer/seller responses with identity, pagination, retry protection and private access', async () => {
    const body = { body: 'Buyer explanation of damage', idempotencyKey: crypto.randomUUID() };
    const first = await call('post', path('messages')).send(body).expect(201);
    const retry = await call('post', path('messages')).send(body).expect(201);
    expect(retry.body.data.message._id).toBe(first.body.data.message._id);
    await call('post', path('messages'))
      .send({ ...body, body: 'Changed content' })
      .expect(409);
    await call('post', path('messages'), seller)
      .send({
        body: 'Seller explanation and packaging details',
        idempotencyKey: crypto.randomUUID(),
      })
      .expect(201);
    const list = await call('get', `${path('messages')}?limit=1`, admin).expect(200);
    expect(list.body.data.pagination.total).toBe(2);
    expect(list.body.data.items[0].authorId.fullName).toBe(seller.fullName);
    expect(list.body.data.items[0].authorId.passwordHash).toBeUndefined();
    await call('post', path('messages'), outsider).send(body).expect(404);
    await call('get', path('messages'), outsider).expect(404);
  });
  it('rate-limits replies without duplicating retried messages', async () => {
    for (let i = 0; i < 20; i += 1)
      await call('post', path('messages'))
        .send({ body: `Message ${i}`, idempotencyKey: crypto.randomUUID() })
        .expect(201);
    await call('post', path('messages'))
      .send({ body: 'Too many messages', idempotencyKey: crypto.randomUUID() })
      .expect(429);
    expect(await Message.countDocuments()).toBe(20);
  });
  it('rejects a stale or unversioned admin decision after new evidence arrives', async () => {
    const oldVersion = await version();
    await upload().expect(201);
    await resolve({ expectedVersion: oldVersion }).then((result) =>
      expect(result.status).toBe(409),
    );
    await call('patch', `/admin/disputes/${dispute._id}/resolve`, admin)
      .send({ status: 'RESOLVED_BUYER', resolution: 'No version supplied' })
      .expect(409);
    expect((await resolve()).status).toBe(200);
  });
  it('serializes evidence upload versus a final decision without accepting late evidence', async () => {
    const data = {
      status: 'RESOLVED_SELLER',
      resolution: 'Seller evidence accepted',
      expectedVersion: 0,
    };
    const results = await Promise.all([
      upload(),
      call('patch', `/admin/disputes/${dispute._id}/resolve`, admin).send(data),
    ]);
    expect(results.filter((result) => result.status < 300)).toHaveLength(1);
    expect(results.find((result) => result.status >= 300).status).toBe(409);
  });
  it('rolls back file bytes, case version and counts when outbox storage fails', async () => {
    jest
      .spyOn(events, 'enqueueNotificationEvent')
      .mockRejectedValueOnce(new Error('Outbox unavailable'));
    await upload().expect(500);
    expect(await Evidence.countDocuments()).toBe(0);
    expect((await Dispute.findById(dispute._id)).evidenceCount).toBe(0);
    expect(await version()).toBe(0);
  });
});

describe('Return before refund', () => {
  it('reserves return-proof capacity after the product-image quota is exhausted', async () => {
    for (let i = 0; i < 10; i += 1)
      await upload(buyer, 'GENERAL', Buffer.concat([png, Buffer.from(`product-${i}`)])).expect(201);
    expect((await requireReturn()).status).toBe(200);
    await upload(
      buyer,
      'RETURN_SHIPPING',
      Buffer.concat([png, Buffer.from('return-receipt')]),
    ).expect(201);
    expect(await Evidence.countDocuments()).toBe(11);
  });
  it('requires rechecking a new admin review and caps shipment corrections before receipt', async () => {
    const staleVersion = await version();
    await call('patch', `/admin/disputes/${dispute._id}/review`, admin)
      .send({ note: 'Additional admin observations' })
      .expect(200);
    expect((await resolve({ expectedVersion: staleVersion })).status).toBe(409);
    expect((await requireReturn()).status).toBe(200);
    for (let i = 0; i < 10; i += 1)
      expect((await shipment({ trackingNumber: `CORRECTION-${i}` })).status).toBe(200);
    expect((await shipment({ trackingNumber: 'CORRECTION-EXTRA' })).status).toBe(429);
    expect((await receipt()).status).toBe(200);
    expect((await shipment({ trackingNumber: 'CANNOT-CHANGE-AFTER-RECEIPT' })).status).toBe(409);
  });
  it('requires admin address/deadline and rejects return requirements before verified delivery', async () => {
    await resolve({ returnRequired: true }).then((result) => expect(result.status).toBe(400));
    await Order.updateOne({ _id: order._id }, { $unset: { deliveredAt: 1 } });
    expect((await requireReturn()).status).toBe(409);
    expect((await Dispute.findById(dispute._id)).status).toBe('OPEN');
  });
  it('blocks refund at every pre-verification stage then permits the linked refund', async () => {
    expect((await requireReturn()).status).toBe(200);
    await call('post', '/admin/manual-refunds', admin).send(refundBody()).expect(409);
    const bypass = refundBody();
    delete bypass.disputeId;
    await call('post', '/admin/manual-refunds', admin).send(bypass).expect(409);
    expect((await shipment()).status).toBe(200);
    expect((await receipt()).status).toBe(200);
    await call('post', '/admin/manual-refunds', admin).send(refundBody()).expect(409);
    expect((await verify()).status).toBe(200);
    await call('post', '/admin/manual-refunds', admin).send(refundBody()).expect(201);
    expect(await Refund.countDocuments()).toBe(1);
    expect((await Dispute.findById(dispute._id)).returnFlow.status).toBe('VERIFIED');
  });
  it('does not allow the legacy refund endpoint to bypass return verification', async () => {
    expect((await requireReturn()).status).toBe(200);
    await Payment.updateOne({ _id: payment._id }, { provider: 'simulator' });
    await call('post', '/admin/refunds', admin)
      .send({
        paymentId: payment.id,
        amount: 100000,
        reason: 'Bypass attempt',
        idempotencyKey: crypto.randomUUID(),
      })
      .expect(409);
    expect(await Refund.countDocuments()).toBe(0);
  });
  it('enforces buyer/seller/admin roles, timestamps and safe tracking links', async () => {
    expect((await shipment()).status).toBe(409);
    expect((await requireReturn()).status).toBe(200);
    await call('post', path('return-shipment'), seller).send({}).expect(403);
    expect(
      (await shipment({ shippedAt: new Date(Date.now() + 86400000).toISOString() })).status,
    ).toBe(400);
    expect((await shipment({ trackingUrl: 'javascript:alert(1)' })).status).toBe(400);
    expect((await receipt()).status).toBe(409);
    expect((await shipment()).status).toBe(200);
    expect((await receipt({}, buyer)).status).toBe(403);
    expect((await verify({}, seller)).status).toBe(403);
    await call('post', path('return-receipt'), outsider)
      .send({ expectedVersion: await version(), note: 'Unrelated receipt confirmation' })
      .expect(403);
  });
  it('protects receipt and admin verification from stale updates and conflicting repeats', async () => {
    expect((await requireReturn()).status).toBe(200);
    expect((await shipment()).status).toBe(200);
    const staleVersion = await version();
    await call('post', path('messages'))
      .send({ body: 'A new packaging observation', idempotencyKey: crypto.randomUUID() })
      .expect(201);
    expect((await receipt({ expectedVersion: staleVersion })).status).toBe(409);
    expect((await receipt()).status).toBe(200);
    const data = { expectedVersion: await version(), note: 'Verified tracking and seller receipt' };
    const results = await Promise.all([
      verify(data),
      verify({ ...data, note: 'Different decision from another admin tab' }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(
      (await Dispute.findById(dispute._id)).auditHistory.filter(
        (entry) => entry.action === 'RETURN_VERIFIED',
      ),
    ).toHaveLength(1);
  });
  it('requires documented return evidence and explicit override when the seller is silent', async () => {
    expect((await requireReturn()).status).toBe(200);
    expect((await shipment()).status).toBe(200);
    expect((await verify()).status).toBe(409);
    const note =
      'Carrier evidence confirms delivery of the returned parcel to the designated recipient.';
    expect((await verify({ overrideSellerConfirmation: true, note })).status).toBe(409);
    await upload(buyer, 'RETURN_SHIPPING').expect(201);
    expect((await verify({ overrideSellerConfirmation: true, note })).status).toBe(200);
    expect(
      (await Dispute.findById(dispute._id)).returnFlow.verification.overrideSellerConfirmation,
    ).toBe(true);
  });
  it('allows direct refund decisions without imposing a return and stops late contributions', async () => {
    expect((await resolve()).status).toBe(200);
    await call('post', '/admin/manual-refunds', admin).send(refundBody()).expect(201);
    await upload().expect(409);
    await call('post', path('messages'))
      .send({ body: 'Too late', idempotencyKey: crypto.randomUUID() })
      .expect(409);
  });
  it('keeps a return decision financially on hold and rejects a duplicate open dispute', async () => {
    expect((await requireReturn()).status).toBe(200);
    await call('post', `/orders/${order._id}/disputes`)
      .send({ reason: 'DAMAGED_ITEM', description: 'Duplicate unresolved buyer case' })
      .expect(409);
    const { reasons } =
      await require('../src/services/settlementEligibility.service').explainEligibility(
        await Order.findById(order._id),
      );
    expect(reasons).toContain('ACTIVE_DISPUTE');
  });
  it('rolls back return verification and history when notification enqueue fails', async () => {
    expect((await requireReturn()).status).toBe(200);
    expect((await shipment()).status).toBe(200);
    expect((await receipt()).status).toBe(200);
    jest
      .spyOn(events, 'enqueueNotificationEvent')
      .mockRejectedValueOnce(new Error('Outbox unavailable'));
    expect((await verify()).status).toBe(500);
    expect((await Dispute.findById(dispute._id)).returnFlow.status).toBe('SELLER_RECEIVED');
    expect((await verify()).status).toBe(200);
  });
});
