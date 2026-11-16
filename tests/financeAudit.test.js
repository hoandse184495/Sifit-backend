const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const User = require('../src/models/user.model');
const Payment = require('../src/models/payment.model');
const Receipt = require('../src/models/paymentTransaction.model');
const Ledger = require('../src/models/ledgerEntry.model');
const { signAccessToken } = require('../src/utils/token');
let mongo, buyer, admin, payment;
const get = (path, user = admin) => request(app).get(`/api/v1/admin/${path}`).set('Authorization', `Bearer ${signAccessToken(user)}`);
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  await Promise.all([User, Payment, Receipt, Ledger].map(model => model.init()));
  [buyer, admin] = await User.create(['BUYER', 'ADMIN'].map((role, index) => ({ role, fullName: 'Finance audit', email: `finance${index}@audit.test`, passwordHash: 'unused' })));
  const group = new mongoose.Types.ObjectId();
  const entries = await Payment.create(['BANK.001', 'BANK-002'].map((merchantReference, index) => ({ buyerId: buyer._id, checkoutGroupId: group, provider: 'simulator', merchantReference, providerPaymentId: `provider-${index}`, amount: 100000, status: index ? 'PENDING' : 'SUCCEEDED', idempotencyKey: `finance-${index}`, requestFingerprint: `finance-${index}`, expiresAt: new Date(Date.now() + 600000), createdAt: new Date(index ? '2026-11-17T17:00:00Z' : '2026-11-16T17:00:00Z') })));
  [payment] = entries;
  await Receipt.create({ provider: 'payos', reference: 'BANK.001', paymentId: payment._id, checkoutGroupId: group, providerPaymentId: 'provider-001', merchantReference: 'BANK.001', amount: 100000, currency: 'VND', occurredAt: new Date(), status: 'MATCHED', source: 'WEBHOOK' });
  await Ledger.create({ sourceType: 'PAYMENT', sourceId: payment.id, sourceEventKey: 'finance-payment-001', description: 'Payment received', lines: [{ account: 'BANK', debit: 100000 }, { account: 'ESCROW', credit: 100000 }] });
});
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
it('restricts payment, receipt and ledger access to admin', async () => {
  for (const path of ['payments', 'payment-transactions', 'ledger']) await get(path, buyer).expect(403);
});
it('searches escaped literal references, identifiers and Vietnam calendar-day boundaries', async () => {
  expect((await get('payments?search=BANK.001').expect(200)).body.data.items).toHaveLength(1);
  expect((await get('payments?search=%5B').expect(200)).body.data.items).toHaveLength(0);
  expect((await get(`payments?search=${payment.id}`).expect(200)).body.data.items).toHaveLength(1);
  const day = (await get('payments?startDate=2026-11-17&endDate=2026-11-17').expect(200)).body.data;
  expect(day.items.map(item => item.merchantReference)).toEqual(['BANK.001']);
  await get('payments?startDate=2026-11-18&endDate=2026-11-17').expect(400);
  await get('payments?startDate=2026-02-31').expect(400);
});
it('returns receipts and balanced ledger entries with working search and pagination', async () => {
  const receipt = (await get('payment-transactions?search=BANK.001&status=MATCHED').expect(200)).body.data;
  expect(receipt.pagination.total).toBe(1);
  expect(receipt.items[0].paymentId).toBe(payment.id);
  const ledger = (await get(`ledger?search=${payment.id}`).expect(200)).body.data;
  expect(ledger.items).toHaveLength(1);
  expect(ledger.items[0].lines.reduce((sum, line) => sum + line.debit - line.credit, 0)).toBe(0);
  expect((await get('ledger?search=missing').expect(200)).body.data.items).toHaveLength(0);
});
