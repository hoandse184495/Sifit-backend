jest.mock('../src/config/cloudinary', () => ({
  uploadBuffer: jest.fn(async () => ({
    secure_url: 'https://res.cloudinary.com/test/image/upload/review.png',
    public_id: `sifit/reviews/test-${Date.now()}-${Math.random()}`,
  })),
  deleteAsset: jest.fn(async () => ({ result: 'ok' })),
}));

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const orderStatus = require('../src/constants/orderStatus');
const paymentStatus = require('../src/constants/paymentStatus');
const roles = require('../src/constants/roles');
const Category = require('../src/models/category.model');
const Dispute = require('../src/models/dispute.model');
const Order = require('../src/models/order.model');
const Product = require('../src/models/product.model');
const ProductReview = require('../src/models/productReview.model');
const SellerProfile = require('../src/models/sellerProfile.model');
const SellerRating = require('../src/models/sellerRating.model');
const User = require('../src/models/user.model');
const Wishlist = require('../src/models/wishlist.model');
const cloudinary = require('../src/config/cloudinary');

let mongoServer;
let category;

const pngBuffer = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

const shippingAddress = {
  recipientName: 'Nguyen Van A',
  phone: '0901234567',
  addressLine: '123 Nguyen Trai',
  ward: 'Ben Thanh',
  city: 'Ho Chi Minh City',
};

const registerAndLogin = async (email, role = roles.BUYER) => {
  const password = 'StrongPassword123!';
  await request(app)
    .post('/api/v1/auth/register')
    .send({ fullName: email.split('@')[0], email, password })
    .expect(201);

  if (role !== roles.BUYER) {
    await User.updateOne({ email }, { role });
  }

  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  const user = await User.findOne({ email });

  return { accessToken: response.body.data.accessToken, user };
};

const createProduct = (sellerId, overrides = {}) =>
  Product.create({
    sellerId,
    title: overrides.title || 'Vintage denim jacket',
    description: 'A clean second-hand item.',
    price: 200000,
    categoryId: category._id,
    brand: 'Levis',
    size: 'M',
    color: 'Blue',
    condition: 'GOOD',
    status: 'ACTIVE',
    images: [{ url: 'https://example.com/image.png', publicId: 'sifit/products/image' }],
    ...overrides,
  });

const createCompletedOrder = (buyerId, sellerId, product, overrides = {}) =>
  Order.create({
    buyerId,
    sellerId,
    items: [
      {
        productId: product._id,
        title: product.title,
        image: product.images[0]?.url,
        price: product.price,
      },
    ],
    shippingAddress,
    subtotal: product.price,
    shippingFee: 0,
    buyerTotal: product.price,
    commissionRateBasisPoints: 1000,
    commissionAmount: Math.round(product.price * 0.1),
    sellerProceeds: Math.round(product.price * 0.9),
    orderStatus: orderStatus.COMPLETED,
    paymentStatus: paymentStatus.PAID,
    reservationExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    deliveredAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    protectionEndsAt: new Date(Date.now() - 60 * 60 * 1000),
    completedAt: new Date(),
    ...overrides,
  });

const createSellerProfile = (sellerId, slug = 'seller-shop') =>
  SellerProfile.create({
    userId: sellerId,
    shopName: 'Seller Shop',
    shopSlug: slug,
    description: 'Curated second-hand fashion.',
    verificationStatus: 'VERIFIED',
    status: 'ACTIVE',
  });

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([
    User.init(),
    Category.init(),
    Product.init(),
    Order.init(),
    Dispute.init(),
    ProductReview.init(),
    SellerRating.init(),
    SellerProfile.init(),
    Wishlist.init(),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Category.deleteMany({}),
    Product.deleteMany({}),
    Order.deleteMany({}),
    Dispute.deleteMany({}),
    ProductReview.deleteMany({}),
    SellerRating.deleteMany({}),
    SellerProfile.deleteMany({}),
    Wishlist.deleteMany({}),
  ]);
  category = await Category.create({ name: 'Ao khoac', slug: 'ao-khoac' });
  jest.clearAllMocks();
});

describe('Product reviews', () => {
  it('allows a verified buyer to review once, list summary, edit, reply, and upload images', async () => {
    const buyer = await registerAndLogin('buyer@example.com');
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const product = await createProduct(seller.user._id, { status: 'SOLD' });
    const order = await createCompletedOrder(buyer.user._id, seller.user._id, product);

    const created = await request(app)
      .post('/api/v1/reviews/products')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        orderId: order.id,
        productId: product.id,
        rating: 5,
        title: 'Great',
        comment: 'Exactly as listed',
      })
      .expect(201);

    expect(created.body.data.review.isVerifiedPurchase).toBe(true);

    await request(app)
      .post('/api/v1/reviews/products')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ orderId: order.id, productId: product.id, rating: 4 })
      .expect(409);

    const summary = await request(app)
      .get(`/api/v1/products/${product.id}/reviews/summary`)
      .expect(200);
    expect(summary.body.data.summary.totalReviews).toBe(1);
    expect(summary.body.data.summary.averageRating).toBe(5);

    await request(app)
      .patch(`/api/v1/reviews/${created.body.data.review._id}`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ rating: 4, comment: 'Still very good' })
      .expect(200);

    await request(app)
      .post(`/api/v1/reviews/${created.body.data.review._id}/reply`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ text: 'Thank you!' })
      .expect(200);

    await request(app)
      .post(`/api/v1/reviews/${created.body.data.review._id}/images`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .attach('images', pngBuffer, 'review.png')
      .expect(200);

    expect(cloudinary.uploadBuffer).toHaveBeenCalledTimes(1);
  });

  it('rejects ineligible orders and hides author-removed reviews from public listings', async () => {
    const buyer = await registerAndLogin('buyer@example.com');
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const other = await registerAndLogin('other@example.com');
    const product = await createProduct(seller.user._id, { status: 'SOLD' });
    const order = await createCompletedOrder(buyer.user._id, seller.user._id, product);
    const pendingOrder = await createCompletedOrder(buyer.user._id, seller.user._id, product, {
      orderStatus: orderStatus.DELIVERED,
      completedAt: undefined,
    });

    await request(app)
      .post('/api/v1/reviews/products')
      .set('Authorization', `Bearer ${other.accessToken}`)
      .send({ orderId: order.id, productId: product.id, rating: 5 })
      .expect(403);

    await request(app)
      .post('/api/v1/reviews/products')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ orderId: pendingOrder.id, productId: product.id, rating: 5 })
      .expect(409);

    const created = await request(app)
      .post('/api/v1/reviews/products')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ orderId: order.id, productId: product.id, rating: 5 })
      .expect(201);

    await request(app)
      .delete(`/api/v1/reviews/${created.body.data.review._id}`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);

    const listed = await request(app).get(`/api/v1/products/${product.id}/reviews`).expect(200);
    expect(listed.body.data.items).toHaveLength(0);
  });

  it('returns author edit deadlines and blocks editing removed or expired review content and images', async () => {
    const buyer = await registerAndLogin('buyer@example.com');
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const product = await createProduct(seller.user._id, { status: 'SOLD' });
    const order = await createCompletedOrder(buyer.user._id, seller.user._id, product);
    const created = await request(app)
      .post('/api/v1/reviews/products')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ orderId: order.id, productId: product.id, rating: 5 })
      .expect(201);
    const reviewId = created.body.data.review._id;
    expect(created.body.data.review.canEdit).toBe(true);
    expect(new Date(created.body.data.review.editDeadline).getTime()).toBeGreaterThan(Date.now());
    await ProductReview.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(reviewId) },
      { $set: { createdAt: new Date(Date.now() - 400 * 86400000) } },
    );
    const listed = await request(app)
      .get('/api/v1/reviews/my')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
    expect(listed.body.data.items[0].canEdit).toBe(false);
    for (const removed of [false, true]) {
      if (removed) {
        await ProductReview.collection.updateOne(
          { _id: new mongoose.Types.ObjectId(reviewId) },
          { $set: { status: 'REMOVED', createdAt: new Date() } },
        );
      }
      await request(app)
        .patch(`/api/v1/reviews/${reviewId}`)
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .send({ rating: 1 })
        .expect(409);
      await request(app)
        .post(`/api/v1/reviews/${reviewId}/images`)
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .attach('images', pngBuffer, 'review.png')
        .expect(409);
      await request(app)
        .delete(`/api/v1/reviews/${reviewId}/images/${encodeURIComponent('sifit/reviews/test')}`)
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .expect(409);
    }
    expect(cloudinary.uploadBuffer).not.toHaveBeenCalled();
  });

  it('enforces review image validation and image limits', async () => {
    const buyer = await registerAndLogin('buyer@example.com');
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const product = await createProduct(seller.user._id, { status: 'SOLD' });
    const order = await createCompletedOrder(buyer.user._id, seller.user._id, product);
    const review = await ProductReview.create({
      productId: product._id,
      orderId: order._id,
      buyerId: buyer.user._id,
      sellerId: seller.user._id,
      rating: 5,
      isVerifiedPurchase: true,
      images: Array.from({ length: 5 }, (_, index) => ({
        url: `https://example.com/${index}.png`,
        publicId: `sifit/reviews/${index}`,
      })),
    });

    await request(app)
      .post(`/api/v1/reviews/${review.id}/images`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .attach('images', Buffer.from('not image'), 'bad.txt')
      .expect(409);
  });
});

describe('Seller ratings and moderation', () => {
  it('creates seller rating, publishes shop ratings, and recalculates reputation on moderation', async () => {
    const buyer = await registerAndLogin('buyer@example.com');
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const admin = await registerAndLogin('admin@example.com', roles.ADMIN);
    await createSellerProfile(seller.user._id);
    const product = await createProduct(seller.user._id, { status: 'SOLD' });
    const order = await createCompletedOrder(buyer.user._id, seller.user._id, product);

    const created = await request(app)
      .post('/api/v1/reviews/sellers')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ orderId: order.id, rating: 5, communicationRating: 5, shippingRating: 4 })
      .expect(201);

    let profile = await SellerProfile.findOne({ userId: seller.user._id });
    expect(profile.ratingAverage).toBe(5);
    expect(profile.ratingCount).toBe(1);

    const publicList = await request(app).get('/api/v1/shops/seller-shop/ratings').expect(200);
    expect(publicList.body.data.items).toHaveLength(1);

    await request(app)
      .patch(`/api/v1/admin/reviews/${created.body.data.rating._id}/hide`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ reason: 'Policy review' })
      .expect(200);

    profile = await SellerProfile.findOne({ userId: seller.user._id });
    expect(profile.ratingAverage).toBe(0);
    expect(profile.ratingCount).toBe(0);

    await request(app)
      .patch(`/api/v1/admin/reviews/${created.body.data.rating._id}/restore`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ reason: 'Resolved' })
      .expect(200);

    profile = await SellerProfile.findOne({ userId: seller.user._id });
    expect(profile.ratingAverage).toBe(5);
    expect(profile.ratingCount).toBe(1);
  });

  it('prevents duplicate seller ratings for the same order', async () => {
    const buyer = await registerAndLogin('buyer@example.com');
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const product = await createProduct(seller.user._id, { status: 'SOLD' });
    const order = await createCompletedOrder(buyer.user._id, seller.user._id, product);

    await request(app)
      .post('/api/v1/reviews/sellers')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ orderId: order.id, rating: 5 })
      .expect(201);

    await request(app)
      .post('/api/v1/reviews/sellers')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ orderId: order.id, rating: 4 })
      .expect(409);
  });
});

describe('Wishlist', () => {
  it('adds, checks, removes, and clears private wishlist items without reserving inventory', async () => {
    const buyer = await registerAndLogin('buyer@example.com');
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const product = await createProduct(seller.user._id);

    await request(app).get('/api/v1/wishlist').expect(401);

    const added = await request(app)
      .post('/api/v1/wishlist/items')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ productId: product.id })
      .expect(201);

    expect(added.body.data.wishlist.items).toHaveLength(1);
    expect((await Product.findById(product._id)).status).toBe('ACTIVE');

    const checked = await request(app)
      .get(`/api/v1/wishlist/items/${product.id}`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
    expect(checked.body.data.isWishlisted).toBe(true);

    await request(app)
      .post('/api/v1/wishlist/items')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ productId: product.id })
      .expect(409);

    await request(app)
      .delete(`/api/v1/wishlist/items/${product.id}`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);

    await request(app)
      .delete('/api/v1/wishlist/items')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
  });

  it('rejects own products and limits unavailable product data in wishlist output', async () => {
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const buyer = await registerAndLogin('buyer@example.com');
    const product = await createProduct(seller.user._id);

    await request(app)
      .post('/api/v1/wishlist/items')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ productId: product.id })
      .expect(403);

    await Wishlist.create({ userId: buyer.user._id, items: [{ productId: product._id }] });
    product.status = 'DRAFT';
    await product.save();

    const response = await request(app)
      .get('/api/v1/wishlist')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);

    expect(response.body.data.wishlist.items[0].availability).toBe('UNAVAILABLE');
    expect(response.body.data.wishlist.items[0].title).toBeUndefined();
  });
});
