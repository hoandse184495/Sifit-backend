const mongoose = require('mongoose');
const { test } = require('@jest/globals');
const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const app = require('../src/app');
const User = require('../src/models/user.model');
const Profile = require('../src/models/sellerProfile.model');
const Verification = require('../src/models/sellerVerification.model');
const Document = require('../src/models/sellerVerificationDocument.model');
const Bank = require('../src/models/sellerBankAccount.model');
const events = require('../src/services/notificationEvent.service');
const policy = require('../src/services/sellerVerificationPolicy.service');
const service = require('../src/services/sellerVerification.service');
const workflow = require('../src/services/marketplaceWorkflow.service');
const { signAccessToken } = require('../src/utils/token');
const { apiLimiter } = require('../src/middlewares/rateLimit.middleware');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);
const body = {
  legalName: 'Nguyễn Đức Hòa',
  phone: '0901234567',
  contactAddress: '123 Fixture Street, HCM',
};
let mongo, seller, admin, buyer, other, profile, bank;
const call = (method, path, user = seller) => {
  const action = request(app)[method](`/api/v1${path}`);
  return action
    .set('Authorization', `Bearer ${signAccessToken(user)}`)
    .set('X-Forwarded-For', '127.0.0.1');
};
const create = async () =>
  (await call('post', '/seller/verification/draft').send(body).expect(201)).body.data.verification;
const version = async (id) => (await Verification.findById(id)).contentVersion;
const upload = (id, kind, bytes = png, user = seller) =>
  call('post', `/seller/verification/${id}/documents/${kind}`, user).attach('document', bytes, {
    filename: 'private.png',
    contentType: 'image/png',
  });
const submit = async (id) =>
  call('post', '/seller/verification/submit').send({
    verificationId: id,
    expectedVersion: await version(id),
    ownsAccount: true,
    consent: true,
  });
const pending = async () => {
  const draft = await create();
  await upload(draft._id, 'OWNER_IDENTITY').expect(201);
  await upload(draft._id, 'BANK_OWNERSHIP').expect(201);
  expect((await submit(draft._id)).status).toBe(201);
  return Verification.findById(draft._id);
};
const review = async (record, action = 'approve', staff = admin) =>
  call('patch', `/admin/seller-verifications/${record._id}/${action}`, staff).send({
    expectedVersion: record.contentVersion,
    reason: 'Đã kiểm tra hồ sơ và tài khoản nhận tiền',
    checkedDocuments: true,
  });
const payoutFixture = async () => {
  const past = new Date(Date.now() - 40 * 86400000);
  const order = await require('../src/models/order.model').create({
    checkoutGroupId: new mongoose.Types.ObjectId(),
    buyerId: buyer._id,
    sellerId: seller._id,
    items: [
      {
        productId: new mongoose.Types.ObjectId(),
        title: 'Verified payout fixture',
        price: 100000,
        quantity: 1,
      },
    ],
    shippingAddress: {
      recipientName: 'Buyer',
      phone: '0901234567',
      addressLine: 'Fixture Street',
      ward: 'Ward',
      city: 'HCM',
    },
    subtotal: 100000,
    buyerTotal: 100000,
    commissionRateBasisPoints: 1000,
    commissionAmount: 10000,
    sellerProceeds: 90000,
    paymentStatus: 'PAID',
    orderStatus: 'COMPLETED',
    deliveredAt: past,
    completedAt: past,
    protectionEndsAt: past,
    completedBy: admin._id,
    reservationExpiresAt: past,
  });
  await require('../src/models/commission.model').create({
    orderId: order._id,
    sellerId: seller._id,
    subtotal: 100000,
    commissionRateBasisPoints: 1000,
    commissionAmount: 10000,
    sellerProceeds: 90000,
  });
  return require('../src/models/sellerPayout.model').create({
    sellerId: seller._id,
    orderIds: [order._id],
    amount: 90000,
    status: 'ELIGIBLE',
    provider: 'manual',
    idempotencyKey: new mongoose.Types.ObjectId().toString(),
  });
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
  [seller, admin, buyer, other] = await User.create(
    ['SELLER', 'ADMIN', 'BUYER', 'SELLER'].map((role, i) => ({
      role,
      fullName: `Verification fixture ${i}`,
      email: `verify${i}@fixture.test`,
      passwordHash: 'fixture',
    })),
  );
  profile = await Profile.create({
    userId: seller._id,
    shopName: 'Verification shop',
    shopSlug: 'verification-shop',
  });
  bank = await Bank.create({
    sellerId: seller._id,
    bankName: 'BIDV',
    bankBin: '970418',
    accountNumber: '123456789',
    accountName: 'NGUYEN DUC HOA',
  });
});
test('submits complete private dossier, freezes content, reviews and enables payout verification', async () => {
  const record = await pending();
  expect(record.verificationStatus).toBe('PENDING');
  expect(record.consentAt).toBeTruthy();
  await upload(record._id, 'OWNER_IDENTITY').expect(409);
  await review(record).then((result) => expect(result.status).toBe(200));
  expect((await Profile.findById(profile._id)).verificationStatus).toBe('VERIFIED');
  expect((await policy.assertVerified(seller._id)).id).toBe(record.id);
  await create().then(
    () => {
      throw new Error('Should reject a new dossier');
    },
    (error) => expect(error.message).toContain('409'),
  );
  await events.processBatch({ limit: 50 });
  expect(
    await require('../src/models/notification.model').countDocuments({
      resourceType: 'VERIFICATION',
    }),
  ).toBe(2);
});
test('restricts creation to sellers with an active shop and bank', async () => {
  await call('post', '/seller/verification/draft', buyer).send(body).expect(403);
  await call('post', '/seller/verification/draft', other).send(body).expect(409);
  await Bank.deleteMany({});
  await call('post', '/seller/verification/draft').send(body).expect(409);
});
test('validates declarations and matching owner names with Vietnamese accents', async () => {
  await call('post', '/seller/verification/draft')
    .send({ ...body, legalName: 'Another Owner' })
    .expect(400);
  await call('post', '/seller/verification/draft')
    .send({ ...body, phone: 'abc' })
    .expect(400);
  const record = await create();
  await call('post', '/seller/verification/submit')
    .send({ verificationId: record._id, expectedVersion: 0, consent: false, ownsAccount: true })
    .expect(400);
  expect(policy.normalizeName(body.legalName)).toBe('NGUYENDUCHOA');
});
test('requires both private document kinds and a fresh content version', async () => {
  const record = await create();
  await (
    await submit(record._id)
  ).status;
  expect((await Verification.findById(record._id)).verificationStatus).toBe('DRAFT');
  await upload(record._id, 'OWNER_IDENTITY').expect(201);
  await call('post', '/seller/verification/submit')
    .send({ verificationId: record._id, expectedVersion: 0, consent: true, ownsAccount: true })
    .expect(409);
  expect((await submit(record._id)).status).toBe(409);
});
test('keeps document bytes private and excludes personal details from admin queue and public shop', async () => {
  const record = await pending();
  for (const user of [buyer, other]) {
    await call('get', `/seller-verifications/${record.id}`, user).expect(404);
    await call('get', `/seller-verifications/${record.id}/documents/OWNER_IDENTITY`, user).expect(
      404,
    );
  }
  await request(app)
    .get(`/api/v1/seller-verifications/${record.id}/documents/OWNER_IDENTITY`)
    .expect(401);
  const result = await call('get', `/seller-verifications/${record.id}`, admin).expect(200);
  expect(JSON.stringify(result.body)).not.toContain(png.toString('base64'));
  expect(result.body.data.documents.every((file) => !file.data && !file.sha256)).toBe(true);
  const file = await call(
    'get',
    `/seller-verifications/${record.id}/documents/OWNER_IDENTITY`,
    admin,
  ).expect(200);
  expect(file.headers['cache-control']).toContain('no-store');
  expect(file.headers['content-disposition']).toContain('attachment');
  expect(file.body.equals(png)).toBe(true);
  const list = await call('get', '/admin/seller-verifications', admin).expect(200);
  expect(JSON.stringify(list.body)).not.toContain('123456789');
  expect(list.body.data.items[0].legalName).toBeUndefined();
  const shop = await request(app).get(`/api/v1/shops/by-seller/${seller.id}`).expect(200);
  expect(JSON.stringify(shop.body)).not.toContain('123456789');
});
test('rejects fake images, oversized uploads and additional multipart fields', async () => {
  const record = await create();
  await upload(record._id, 'OWNER_IDENTITY', Buffer.from('<svg>fake</svg>')).expect(400);
  await upload(record._id, 'BANK_OWNERSHIP', Buffer.alloc(5 * 1024 * 1024 + 1)).expect(413);
  await call('post', `/seller/verification/${record._id}/documents/OWNER_IDENTITY`)
    .field('unexpected', 'x')
    .attach('document', png, 'private.png')
    .expect(400);
  expect(await Document.countDocuments({})).toBe(0);
});
test('supports replacing/removing a draft image without accumulating documents', async () => {
  const record = await create();
  await upload(record._id, 'OWNER_IDENTITY').expect(201);
  await upload(record._id, 'OWNER_IDENTITY').expect(201);
  expect(await Document.countDocuments({ verificationId: record._id })).toBe(1);
  await call('delete', `/seller/verification/${record._id}/documents/OWNER_IDENTITY`).expect(200);
  expect(await Document.countDocuments({ verificationId: record._id })).toBe(0);
  await upload(record._id, 'BANK_OWNERSHIP', png, other).expect(404);
});
test('allows only one active dossier under concurrent creation', async () => {
  const results = await Promise.all([
    call('post', '/seller/verification/draft').send(body),
    call('post', '/seller/verification/draft').send(body),
  ]);
  expect(results.map((item) => item.status).sort()).toEqual([201, 409]);
  expect(await Verification.countDocuments({})).toBe(1);
});
test('rejects two conflicting admin decisions and keeps one history decision', async () => {
  const record = await pending();
  const results = await Promise.all([review(record, 'approve'), review(record, 'reject')]);
  expect(results.map((item) => item.status).sort()).toEqual([200, 409]);
  expect(
    (await Verification.findById(record.id)).history.filter((entry) =>
      ['VERIFIED', 'REJECTED'].includes(entry.action),
    ),
  ).toHaveLength(1);
});
test('requires admin role, an independent reviewer, a reason and explicit document confirmation', async () => {
  const record = await pending();
  await review(record, 'approve', seller).then((result) => expect(result.status).toBe(403));
  await call('patch', `/admin/seller-verifications/${record.id}/approve`, admin)
    .send({ expectedVersion: record.contentVersion, reason: 'Đã kiểm tra thông tin đầy đủ' })
    .expect(409);
  await call('patch', `/admin/seller-verifications/${record.id}/reject`, admin)
    .send({ expectedVersion: record.contentVersion, reason: '' })
    .expect(400);
  await User.updateOne({ _id: seller._id }, { role: 'ADMIN' });
  await service
    .review({
      id: record.id,
      admin: { _id: seller._id, role: 'ADMIN' },
      status: 'VERIFIED',
      expectedVersion: record.contentVersion,
      checkedDocuments: true,
      reason: 'Own dossier is prohibited',
    })
    .then(
      () => {
        throw new Error('Self review');
      },
      (error) => expect(error.statusCode).toBe(403),
    );
});
test('preserves a rejected submission when the seller submits a replacement dossier', async () => {
  const old = await pending();
  await review(old, 'reject').then((result) => expect(result.status).toBe(200));
  const next = await pending();
  expect(next.id).not.toBe(old.id);
  expect((await Verification.findById(old.id)).rejectionReason).toBeTruthy();
  expect(await Document.countDocuments({ verificationId: old.id })).toBe(2);
  await review(next).then((result) => expect(result.status).toBe(200));
  expect(
    (await call('get', '/admin/seller-verifications?status=REJECTED&limit=1', admin)).body.data
      .pagination.total,
  ).toBe(1);
});
test('bank changes while pending invalidate submission and block stale approval', async () => {
  const record = await pending();
  await workflow.saveBank(seller, { ...policy.bankSnapshot(bank), accountNumber: '987654321' });
  expect((await Verification.findById(record.id)).verificationStatus).toBe('REJECTED');
  expect((await Profile.findById(profile.id)).verificationStatus).toBe('NOT_SUBMITTED');
  await review(record).then((result) => expect(result.status).toBe(409));
});
test('bank change races with approval without leaving a mismatched verified shop', async () => {
  const record = await pending();
  await Promise.allSettled([
    service.review({
      id: record.id,
      admin,
      status: 'VERIFIED',
      expectedVersion: record.contentVersion,
      reason: 'Checked all documents and bank',
      checkedDocuments: true,
    }),
    workflow.saveBank(seller, { ...policy.bankSnapshot(bank), accountNumber: '987654321' }),
  ]);
  expect((await Profile.findById(profile.id)).verificationStatus).not.toBe('VERIFIED');
  await expect(policy.assertVerified(seller.id)).rejects.toMatchObject({ statusCode: 409 });
});
test('updating a draft after a bank change removes stale bank evidence and rejects stale edits', async () => {
  const record = await create();
  await upload(record._id, 'BANK_OWNERSHIP').expect(201);
  await workflow.saveBank(seller, { ...policy.bankSnapshot(bank), accountNumber: '987654321' });
  await call('put', `/seller/verification/${record._id}`)
    .send({ ...body, expectedVersion: 0 })
    .expect(409);
  await call('put', `/seller/verification/${record._id}`)
    .send({ ...body, expectedVersion: await version(record._id) })
    .expect(200);
  expect(await Document.countDocuments({ verificationId: record._id })).toBe(0);
  expect((await Verification.findById(record._id)).bankSnapshot.accountNumber).toBe('987654321');
});
test('verified bank changes require a new dossier while the original approved snapshot stays verifiable', async () => {
  const record = await pending();
  await review(record).then((result) => expect(result.status).toBe(200));
  await workflow.saveBank(seller, { ...policy.bankSnapshot(bank), accountNumber: '987654321' });
  await expect(policy.assertVerified(seller.id)).rejects.toMatchObject({ statusCode: 409 });
  expect((await policy.assertSnapshot(seller.id, record.id, policy.bankSnapshot(bank))).id).toBe(
    record.id,
  );
  const next = await create();
  expect(next.bankSnapshot.accountNumber).toBe('987654321');
});
test('does not invalidate verification for formatting-only edits of the same bank identity', async () => {
  const record = await pending();
  await review(record).then((result) => expect(result.status).toBe(200));
  await workflow.saveBank(seller, {
    ...policy.bankSnapshot(bank),
    accountName: 'Nguyễn Đức Hòa',
    bankName: 'BIDV Bank',
  });
  expect((await policy.assertVerified(seller.id)).id).toBe(record.id);
});
test('legacy simulated approval cannot grant manual payout verification and may be replaced', async () => {
  await Profile.updateOne({ _id: profile.id }, { verificationStatus: 'VERIFIED' });
  await Verification.create({
    sellerId: profile.id,
    verificationStatus: 'VERIFIED',
    verificationMethod: 'SIMULATED_REVIEW',
  });
  await expect(policy.assertVerified(seller.id)).rejects.toMatchObject({ statusCode: 409 });
  expect(
    (await call('get', '/seller/verification/status')).body.data.verification.payoutVerified,
  ).toBe(false);
  expect((await create()).verificationStatus).toBe('DRAFT');
});
test('legacy pending simulations can only be rejected, not silently approved', async () => {
  const record = await Verification.create({
    sellerId: profile.id,
    verificationMethod: 'SIMULATED_REVIEW',
    verificationStatus: 'PENDING',
  });
  await review(record).then((result) => expect(result.status).toBe(409));
  await review(record, 'reject').then((result) => expect(result.status).toBe(200));
});
test('rolls back submission and approval when notification outbox fails', async () => {
  const record = await create();
  await upload(record._id, 'OWNER_IDENTITY').expect(201);
  await upload(record._id, 'BANK_OWNERSHIP').expect(201);
  jest.spyOn(events, 'enqueueNotificationEvent').mockRejectedValue(new Error('Outbox unavailable'));
  expect((await submit(record._id)).status).toBe(500);
  expect((await Verification.findById(record._id)).verificationStatus).toBe('DRAFT');
  expect((await Profile.findById(profile.id)).verificationStatus).toBe('NOT_SUBMITTED');
  jest.restoreAllMocks();
  expect((await submit(record._id)).status).toBe(201);
  const current = await Verification.findById(record._id);
  jest.spyOn(events, 'enqueueNotificationEvent').mockRejectedValue(new Error('Outbox unavailable'));
  expect((await review(current)).status).toBe(500);
  expect((await Verification.findById(record._id)).verificationStatus).toBe('PENDING');
  expect(await require('../src/models/adminAuditLog.model').countDocuments({})).toBe(0);
});
test('blocks approval for a suspended shop or owner and leaves the dossier pending', async () => {
  const record = await pending();
  await Profile.updateOne({ _id: profile.id }, { status: 'SUSPENDED' });
  expect((await review(record)).status).toBe(409);
  expect((await Verification.findById(record.id)).verificationStatus).toBe('PENDING');
});
test('blocks manual payout approval without a real dossier and disallows the legacy approval bypass', async () => {
  await Profile.updateOne({ _id: profile._id }, { verificationStatus: 'VERIFIED' });
  const payout = await payoutFixture();
  await call('post', `/admin/payouts/${payout.id}/approve`, admin).send({}).expect(409);
  await expect(
    require('../src/services/payout.service').approvePayout(payout._id),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect((await require('../src/models/sellerPayout.model').findById(payout.id)).status).toBe(
    'ELIGIBLE',
  );
});
test('freezes the approved verification and bank while blocking new payouts after a bank edit', async () => {
  const dossier = await pending();
  expect((await review(dossier)).status).toBe(200);
  const payout = await payoutFixture();
  await call('post', `/admin/payouts/${payout.id}/approve`, admin).send({}).expect(200);
  const Payout = require('../src/models/sellerPayout.model');
  expect(String((await Payout.findById(payout.id)).verificationId)).toBe(dossier.id);
  await workflow.saveBank(seller, { ...policy.bankSnapshot(bank), accountNumber: '987654321' });
  const next = await payoutFixture();
  await call('post', `/admin/payouts/${next.id}/approve`, admin).send({}).expect(409);
  await call('post', `/admin/payouts/${payout.id}/record-transfer`, admin)
    .send({
      amount: 90000,
      reference: 'VERIFIED-SNAPSHOT-001',
      note: 'Đã chuyển đúng tài khoản đã chốt trước khi đổi ngân hàng',
      transferred: true,
    })
    .expect(200);
  expect((await Payout.findById(payout.id)).bankSnapshot.accountNumber).toBe(bank.accountNumber);
  expect((await Payout.findById(payout.id)).status).toBe('PAID');
});
test('rolls back bank edits and verification invalidation if the notification outbox fails', async () => {
  const record = await pending();
  expect((await review(record)).status).toBe(200);
  jest.spyOn(events, 'enqueueNotificationEvent').mockRejectedValue(new Error('Outbox unavailable'));
  await expect(
    workflow.saveBank(seller, { ...policy.bankSnapshot(bank), accountNumber: '987654321' }),
  ).rejects.toThrow('Outbox unavailable');
  expect((await Bank.findOne({ sellerId: seller.id })).accountNumber).toBe(bank.accountNumber);
  expect((await Profile.findById(profile.id)).verificationStatus).toBe('VERIFIED');
});
test('links an old approved payout only after a real review of the exact frozen bank', async () => {
  const Payout = require('../src/models/sellerPayout.model');
  const payout = await payoutFixture();
  await Payout.updateOne(
    { _id: payout._id },
    { status: 'APPROVED', bankSnapshot: policy.bankSnapshot(bank) },
  );
  await call('post', `/admin/payouts/${payout.id}/approve`, admin).send({}).expect(409);
  const dossier = await pending();
  expect((await review(dossier)).status).toBe(200);
  await call('post', `/admin/payouts/${payout.id}/approve`, admin).send({}).expect(200);
  expect(String((await Payout.findById(payout.id)).verificationId)).toBe(dossier.id);
  expect((await Payout.findById(payout.id)).bankSnapshot.accountNumber).toBe(bank.accountNumber);
  const mismatch = await payoutFixture();
  await Payout.updateOne(
    { _id: mismatch._id },
    {
      status: 'APPROVED',
      bankSnapshot: { ...policy.bankSnapshot(bank), accountNumber: '000012345' },
    },
  );
  await call('post', `/admin/payouts/${mismatch.id}/approve`, admin).send({}).expect(409);
  expect((await Payout.findById(mismatch.id)).verificationId).toBeUndefined();
});
