const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const app = require('../src/app');
const User = require('../src/models/user.model');
const Shop = require('../src/models/sellerProfile.model');
const Order = require('../src/models/order.model');
const Commission = require('../src/models/commission.model');
const Payout = require('../src/models/sellerPayout.model');
const Dispute = require('../src/models/dispute.model');
const Outbox = require('../src/models/outboxEvent.model');
const Cursor = require('../src/models/workerCursor.model');
const Category = require('../src/models/category.model');
const Product = require('../src/models/product.model');
const settlements = require('../src/services/settlementEligibility.service');
const disputes = require('../src/services/dispute.service');
const events = require('../src/services/notificationEvent.service');
const products = require('../src/services/product.service');
const { signAccessToken } = require('../src/utils/token');

let mongo, buyer, seller, admin;
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
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
  [buyer, seller, admin] = await User.create(
    ['BUYER', 'SELLER', 'ADMIN'].map((role, index) => ({
      fullName: `Fixture ${role}`,
      email: `fixture${index}@example.test`,
      role,
      passwordHash: 'fixture',
    })),
  );
  await Shop.create({
    userId: seller._id,
    shopName: 'Fixture Shop',
    shopSlug: 'fixture-shop',
    verificationStatus: 'VERIFIED',
  });
});

const createOrders = async (count, overrides = {}) => {
  const past = new Date(Date.now() - 30 * 86400000);
  const docs = await Order.create(
    Array.from({ length: count }, () => ({
      buyerId: buyer._id,
      sellerId: seller._id,
      checkoutGroupId: new mongoose.Types.ObjectId(),
      items: [
        {
          productId: new mongoose.Types.ObjectId(),
          title: 'Fixture garment',
          price: 100000,
          quantity: 1,
        },
      ],
      shippingAddress: {
        recipientName: 'Buyer',
        phone: '0901234567',
        addressLine: 'Test street',
        ward: 'Ward',
        city: 'City',
      },
      subtotal: 100000,
      buyerTotal: 100000,
      commissionRateBasisPoints: 1000,
      commissionAmount: 10000,
      sellerProceeds: 90000,
      paymentStatus: 'PAID',
      orderStatus: 'COMPLETED',
      deliveredAt: past,
      protectionEndsAt: past,
      completedAt: past,
      completedBy: admin._id,
      reservationExpiresAt: past,
      ...overrides,
    })),
  );
  await Commission.create(
    docs.map((order) => ({
      orderId: order._id,
      sellerId: order.sellerId,
      subtotal: 100000,
      commissionRateBasisPoints: 1000,
      commissionAmount: 10000,
      sellerProceeds: 90000,
    })),
  );
  return docs;
};
const createDispute = async () => {
  const [order] = await createOrders(1);
  return Dispute.create({
    orderId: order._id,
    buyerId: buyer._id,
    sellerId: seller._id,
    reason: 'ITEM_NOT_AS_DESCRIBED',
    description: 'Concurrent admin fixture',
    status: 'UNDER_REVIEW',
  });
};

describe('Payout scanning regression', () => {
  it('reaches order 51 using persisted progress and never creates duplicate payouts', async () => {
    await createOrders(51);
    expect((await settlements.evaluateEligibleOrders()).eligibleCount).toBe(50);
    // The persisted cursor, rather than process memory, drives the next invocation.
    expect((await Cursor.findById('payout-eligibility')).afterId).toBeTruthy();
    expect((await settlements.evaluateEligibleOrders()).eligibleCount).toBe(1);
    expect((await settlements.evaluateEligibleOrders()).eligibleCount).toBe(0);
    expect(await Payout.countDocuments()).toBe(51);
    expect(await Outbox.countDocuments({ 'payload.type': 'PAYOUT_ELIGIBLE' })).toBe(51);
  });
  it('passes 50 ineligible orders, then revisits them once eligibility changes', async () => {
    const blocked = await createOrders(50, { protectionEndsAt: new Date(Date.now() + 86400000) });
    await createOrders(1);
    expect((await settlements.evaluateEligibleOrders()).eligibleCount).toBe(0);
    expect((await settlements.evaluateEligibleOrders()).eligibleCount).toBe(1);
    await Order.updateMany(
      { _id: { $in: blocked.map((order) => order._id) } },
      { protectionEndsAt: new Date(0) },
    );
    expect((await settlements.evaluateEligibleOrders()).eligibleCount).toBe(50);
    expect(await Payout.countDocuments()).toBe(51);
  });
  it('finishes a bounded pass while new orders arrive, revisiting older blocked orders', async () => {
    const blocked = await createOrders(1, { protectionEndsAt: new Date(Date.now() + 86400000) });
    await createOrders(4);
    expect((await settlements.evaluateEligibleOrders({ limit: 2 })).eligibleCount).toBe(1);
    const bound = (await Cursor.findById('payout-eligibility')).untilId;
    await createOrders(3);
    await settlements.evaluateEligibleOrders({ limit: 2 });
    expect(String((await Cursor.findById('payout-eligibility')).untilId)).toBe(String(bound));
    await settlements.evaluateEligibleOrders({ limit: 2 });
    expect((await Cursor.findById('payout-eligibility')).afterId).toBeNull();
    await Order.updateOne({ _id: blocked[0]._id }, { protectionEndsAt: new Date(0) });
    expect((await settlements.evaluateEligibleOrders({ limit: 2 })).eligibleCount).toBe(1);
  });
  it('serializes concurrent evaluations without duplicate payouts or cursor failures', async () => {
    await createOrders(11);
    await Promise.all([
      settlements.evaluateEligibleOrders({ limit: 5 }),
      settlements.evaluateEligibleOrders({ limit: 5 }),
    ]);
    await settlements.evaluateEligibleOrders({ limit: 5 });
    await settlements.evaluateEligibleOrders({ limit: 5 });
    expect(await Payout.countDocuments()).toBe(11);
    expect(await Outbox.countDocuments({ 'payload.type': 'PAYOUT_ELIGIBLE' })).toBe(11);
  });
  it('rolls back payout creation if the notification cannot be stored, allowing retry', async () => {
    await createOrders(1);
    jest
      .spyOn(events, 'enqueueNotificationEvent')
      .mockRejectedValueOnce(new Error('Outbox unavailable'));
    await expect(settlements.evaluateEligibleOrders()).rejects.toThrow('Outbox unavailable');
    expect(await Payout.countDocuments()).toBe(0);
    expect(await Cursor.countDocuments()).toBe(0);
    expect((await settlements.evaluateEligibleOrders()).eligibleCount).toBe(1);
  });
});

describe('Dispute decision regression', () => {
  it('enforces admin access and returns HTTP 409 to a competing resolution request', async () => {
    const dispute = await createDispute();
    const endpoint = `/api/v1/admin/disputes/${dispute._id}/resolve`;
    await request(app)
      .patch(endpoint)
      .set('Authorization', `Bearer ${signAccessToken(buyer)}`)
      .send({ status: 'RESOLVED_BUYER', resolution: 'Unauthorized request' })
      .expect(403);
    const results = await Promise.all(
      ['RESOLVED_BUYER', 'RESOLVED_SELLER'].map((status) =>
        request(app)
          .patch(endpoint)
          .set('Authorization', `Bearer ${signAccessToken(admin)}`)
          .send({ status, resolution: `Decision ${status}` }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  });
  it('does not reopen a resolved dispute when review and resolution overlap', async () => {
    const dispute = await createDispute();
    await Promise.allSettled([
      disputes.reviewDispute(dispute._id, admin, 'Review from another tab'),
      disputes.resolveDispute(dispute._id, admin, {
        status: 'RESOLVED_BUYER',
        resolution: 'Final decision',
      }),
    ]);
    const saved = await Dispute.findById(dispute._id);
    expect(saved.status).toBe('RESOLVED_BUYER');
    expect(saved.auditHistory.filter((entry) => entry.action === 'RESOLVE')).toHaveLength(1);
  });
  it('accepts one conflicting decision and returns conflict for the second admin', async () => {
    const dispute = await createDispute();
    const decisions = await Promise.allSettled([
      disputes.resolveDispute(dispute._id, admin, {
        status: 'RESOLVED_BUYER',
        resolution: 'Refund buyer',
      }),
      disputes.resolveDispute(dispute._id, admin, {
        status: 'RESOLVED_SELLER',
        resolution: 'Release seller funds',
      }),
    ]);
    expect(decisions.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(decisions.find((result) => result.status === 'rejected').reason.statusCode).toBe(409);
    const saved = await Dispute.findById(dispute._id);
    expect(saved.auditHistory.filter((entry) => entry.action === 'RESOLVE')).toHaveLength(1);
    expect(saved.resolution).toBe(
      decisions.find((result) => result.status === 'fulfilled').value.resolution,
    );
    expect(
      await Outbox.countDocuments({ eventKey: new RegExp(`^dispute:${dispute._id}:resolved:`) }),
    ).toBe(2);
    await expect(disputes.reviewDispute(dispute._id, admin, 'Stale review')).rejects.toMatchObject({
      statusCode: 409,
    });
    expect((await Dispute.findById(dispute._id)).status).toBe(saved.status);
  });
  it('rolls back status, history and first notification if the second notification fails', async () => {
    const dispute = await createDispute();
    const original = events.enqueueNotificationEvent;
    jest
      .spyOn(events, 'enqueueNotificationEvent')
      .mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error('Outbox unavailable'));
    await expect(
      disputes.resolveDispute(dispute._id, admin, {
        status: 'RESOLVED_BUYER',
        resolution: 'Refund buyer',
      }),
    ).rejects.toThrow('Outbox unavailable');
    const saved = await Dispute.findById(dispute._id);
    expect(saved.status).toBe('UNDER_REVIEW');
    expect(saved.auditHistory).toHaveLength(0);
    expect(await Outbox.countDocuments()).toBe(0);
    expect((await Order.findById(dispute.orderId)).settlementVersion).toBe(0);
  });
  it('keeps a buyer resolution ineligible even when evaluation runs concurrently', async () => {
    const dispute = await createDispute();
    await Promise.all([
      disputes.resolveDispute(dispute._id, admin, {
        status: 'RESOLVED_BUYER',
        resolution: 'Buyer evidence accepted',
      }),
      settlements.evaluateEligibleOrders(),
    ]);
    expect(await Payout.countDocuments()).toBe(0);
  });
});

describe('Public seller visibility regression', () => {
  it('marks saved cart/wishlist items unavailable and blocks checkout after a shop is suspended', async () => {
    const category = await Category.create({ name: 'Shirts', slug: 'shirts' });
    const product = await Product.create({
      sellerId: seller._id,
      categoryId: category._id,
      title: 'Vintage shirt',
      description: 'Cotton garment',
      price: 100000,
      size: 'M',
      condition: 'GOOD',
      status: 'ACTIVE',
    });
    const carts = require('../src/services/cart.service');
    const wishlists = require('../src/services/wishlist.service');
    await carts.addItem(buyer, product._id);
    await wishlists.addItem(buyer, product._id);
    await Shop.updateOne({ userId: seller._id }, { status: 'SUSPENDED' });
    expect((await carts.getCart(buyer)).items[0].available).toBe(false);
    expect((await carts.getCart(buyer)).estimatedSubtotal).toBe(0);
    expect((await wishlists.getWishlist(buyer)).items[0].availability).toBe('UNAVAILABLE');
    await expect(carts.addItem(buyer, product._id)).rejects.toMatchObject({ statusCode: 400 });
    await expect(wishlists.addItem(buyer, product._id)).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      require('../src/services/checkout.service').createCheckout({
        buyer,
        shippingAddress: {
          recipientName: 'Buyer',
          phone: '0901234567',
          addressLine: 'Test street',
          ward: 'Ward',
          city: 'City',
        },
        idempotencyKey: 'suspended-shop-checkout',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect((await Product.findById(product._id)).status).toBe('ACTIVE');
    expect(await Order.countDocuments()).toBe(0);
  });
  it('filters suspended, deleted and non-seller owners before counting and paginating', async () => {
    const category = await Category.create({ name: 'Shirts', slug: 'shirts' });
    const hidden = await User.create({
      fullName: 'Hidden Seller',
      email: 'hidden@example.test',
      passwordHash: 'fixture',
      role: 'SELLER',
      status: 'SUSPENDED',
    });
    const payload = {
      categoryId: category._id,
      title: 'Vintage shirt',
      description: 'Cotton garment',
      price: 100000,
      size: 'M',
      condition: 'GOOD',
      status: 'ACTIVE',
      brand: 'Public Brand',
    };
    const visible = await Product.create({ ...payload, sellerId: seller._id });
    await Product.create([
      { ...payload, sellerId: hidden._id, brand: 'Blocked Brand' },
      { ...payload, sellerId: buyer._id, brand: 'Buyer Brand' },
      { ...payload, sellerId: new mongoose.Types.ObjectId(), brand: 'Missing Brand' },
    ]);
    const page = await products.listPublicProducts({
      page: 1,
      limit: 1,
      categoryIds: [String(category._id)],
      search: 'shirt',
    });
    expect(page.pagination).toEqual({ page: 1, limit: 1, total: 1, pages: 1 });
    expect(String(page.items[0]._id)).toBe(String(visible._id));
    expect(page.items[0].sellerId.fullName).toBe(seller.fullName);
    expect(page.items[0].sellerId.passwordHash).toBeUndefined();
    expect((await products.listPublicProducts({ page: 2, limit: 1 })).items).toHaveLength(0);
    expect((await products.getPublicFacets()).brands).toEqual(['Public Brand']);
    await User.updateOne({ _id: seller._id }, { status: 'SUSPENDED' });
    await request(app).get(`/api/v1/products/${visible._id}`).expect(404);
    expect((await products.listPublicProducts({})).pagination.total).toBe(0);
    await User.updateOne({ _id: seller._id }, { status: 'ACTIVE' });
    await request(app).get(`/api/v1/products/${visible._id}`).expect(200);
    await Shop.updateOne({ userId: seller._id }, { status: 'SUSPENDED' });
    await request(app).get(`/api/v1/products/${visible._id}`).expect(404);
    expect((await products.getPublicFacets()).brands).toEqual([]);
    expect((await products.listPublicProducts({})).pagination.total).toBe(0);
    // Existing active accounts without a shop record remain compatible.
    await Shop.deleteOne({ userId: seller._id });
    expect((await products.listPublicProducts({ brand: 'Public Brand' })).pagination.total).toBe(1);
  });
});
