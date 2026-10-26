const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const commissionStatus = require('../src/constants/commissionStatus');
const orderStatus = require('../src/constants/orderStatus');
const paymentStatus = require('../src/constants/paymentStatus');
const payoutStatus = require('../src/constants/payoutStatus');
const roles = require('../src/constants/roles');
const AdminAuditLog = require('../src/models/adminAuditLog.model');
const AuthSession = require('../src/models/authSession.model');
const Category = require('../src/models/category.model');
const Commission = require('../src/models/commission.model');
const Order = require('../src/models/order.model');
const Product = require('../src/models/product.model');
const Refund = require('../src/models/refund.model');
const SellerPayout = require('../src/models/sellerPayout.model');
const SellerProfile = require('../src/models/sellerProfile.model');
const User = require('../src/models/user.model');

let mongoServer;
let category;

const registerAndLogin = async (email, role = roles.BUYER, fullName = email.split('@')[0]) => {
  const password = 'StrongPassword123!';
  await request(app).post('/api/v1/auth/register').send({ fullName, email, password }).expect(201);
  if (role !== roles.BUYER) await User.updateOne({ email }, { role });
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  const user = await User.findOne({ email });
  return { accessToken: response.body.data.accessToken, user };
};

const createOrder = (buyerId, sellerId, overrides = {}) =>
  Order.create({
    buyerId,
    sellerId,
    items: [{ productId: new mongoose.Types.ObjectId(), title: 'Jacket', price: 200000 }],
    shippingAddress: {
      recipientName: 'Nguyen Van A',
      phone: '0901234567',
      addressLine: '123 Nguyen Trai',
      ward: 'Ben Thanh',
      city: 'Ho Chi Minh City',
    },
    subtotal: 200000,
    shippingFee: 0,
    buyerTotal: 200000,
    commissionRateBasisPoints: 1000,
    commissionAmount: 20000,
    sellerProceeds: 180000,
    orderStatus: orderStatus.COMPLETED,
    paymentStatus: paymentStatus.PAID,
    reservationExpiresAt: new Date(Date.now() + 60 * 1000),
    ...overrides,
  });

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([
    User.init(),
    AuthSession.init(),
    Category.init(),
    Product.init(),
    Order.init(),
    Commission.init(),
    Refund.init(),
    SellerPayout.init(),
    SellerProfile.init(),
    AdminAuditLog.init(),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    AuthSession.deleteMany({}),
    Category.deleteMany({}),
    Product.deleteMany({}),
    Order.deleteMany({}),
    Commission.deleteMany({}),
    Refund.deleteMany({}),
    SellerPayout.deleteMany({}),
    SellerProfile.deleteMany({}),
    AdminAuditLog.deleteMany({}),
  ]);
  category = await Category.create({ name: 'Ao khoac', slug: 'ao-khoac' });
});

describe('Admin dashboard and analytics', () => {
  it('requires admin access and returns zero metrics for empty data', async () => {
    const user = await registerAndLogin('user@example.com');
    const admin = await registerAndLogin('admin@example.com', roles.ADMIN);

    await request(app).get('/api/v1/admin/dashboard/overview').expect(401);
    await request(app)
      .get('/api/v1/admin/dashboard/overview')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(403);

    const response = await request(app)
      .get('/api/v1/admin/dashboard/overview')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(response.body.data.totalProducts).toBe(0);
    expect(response.body.data.grossMerchandiseValue).toBe(0);
    expect(response.body.data.platformCommissionEarned).toBe(0);
  });

  it('aggregates marketplace and financial metrics without double-counting gross as revenue', async () => {
    const buyer = await registerAndLogin('buyer@example.com');
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const admin = await registerAndLogin('admin@example.com', roles.ADMIN);
    const product = await Product.create({
      sellerId: seller.user._id,
      title: 'Vintage jacket',
      description: 'Clean second-hand jacket',
      price: 200000,
      categoryId: category._id,
      size: 'M',
      condition: 'GOOD',
      status: 'SOLD',
    });
    await SellerProfile.create({
      userId: seller.user._id,
      shopName: 'Seller Shop',
      shopSlug: 'seller-shop',
      verificationStatus: 'VERIFIED',
      status: 'ACTIVE',
    });
    const order = await createOrder(buyer.user._id, seller.user._id, {
      items: [{ productId: product._id, title: product.title, price: product.price }],
    });
    const commission = await Commission.create({
      orderId: order._id,
      sellerId: seller.user._id,
      subtotal: order.subtotal,
      commissionRateBasisPoints: 1000,
      commissionAmount: 20000,
      sellerProceeds: 180000,
      status: commissionStatus.RECOGNIZED,
    });
    await SellerPayout.create({
      sellerId: seller.user._id,
      orderIds: [order._id],
      amount: 180000,
      status: payoutStatus.PAID,
    });

    const response = await request(app)
      .get('/api/v1/admin/dashboard/overview')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(response.body.data.totalSellers).toBe(1);
    expect(response.body.data.soldProducts).toBe(1);
    expect(response.body.data.grossMerchandiseValue).toBe(200000);
    expect(response.body.data.platformCommissionEarned).toBe(commission.commissionAmount);
    expect(response.body.data.platformCommissionEarned).not.toBe(
      response.body.data.grossMerchandiseValue,
    );
    expect(response.body.data.completedPayoutAmount).toBe(180000);
  });

  it('returns analytics series for configured business timezone buckets', async () => {
    const buyer = await registerAndLogin('buyer@example.com');
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const admin = await registerAndLogin('admin@example.com', roles.ADMIN);
    await createOrder(buyer.user._id, seller.user._id);

    const response = await request(app)
      .get('/api/v1/admin/dashboard/orders')
      .query({ groupBy: 'day' })
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(response.body.data.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(response.body.data.series[0].created).toBe(1);
  });
});

describe('Admin user management and reports', () => {
  it('requires suspension reason, prevents self-suspension, revokes sessions, and writes audit logs', async () => {
    const admin = await registerAndLogin('admin@example.com', roles.ADMIN);
    const otherAdmin = await registerAndLogin('other-admin@example.com', roles.ADMIN);
    const user = await registerAndLogin('user@example.com');
    await AuthSession.create({
      user: user.user._id,
      familyId: 'family',
      tokenIdHash: 'hash',
      expiresAt: new Date(Date.now() + 3600 * 1000),
    });

    await request(app)
      .patch(`/api/v1/admin/users/${user.user.id}/status`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ status: 'SUSPENDED' })
      .expect(400);

    await request(app)
      .patch(`/api/v1/admin/users/${admin.user.id}/status`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ status: 'SUSPENDED', reason: 'Nope' })
      .expect(409);

    await request(app)
      .patch(`/api/v1/admin/users/${user.user.id}/status`)
      .set('Authorization', `Bearer ${otherAdmin.accessToken}`)
      .send({ status: 'SUSPENDED', reason: 'Abuse' })
      .expect(200);

    expect((await User.findById(user.user._id)).status).toBe('SUSPENDED');
    expect((await AuthSession.findOne({ user: user.user._id })).revokedAt).toBeInstanceOf(Date);
    expect(await AdminAuditLog.countDocuments({ action: 'USER_SUSPENDED' })).toBe(1);
  });

  it('exports users as CSV with formula injection protection', async () => {
    const admin = await registerAndLogin('admin@example.com', roles.ADMIN);
    await registerAndLogin('formula@example.com', roles.BUYER, '=cmd');

    const response = await request(app)
      .get('/api/v1/admin/reports/users/export')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text).toContain('"\'=cmd"');
    expect(response.text).not.toContain('passwordHash');
    expect(await AdminAuditLog.countDocuments({ action: 'EXPORT_USERS' })).toBe(1);
  });
});
