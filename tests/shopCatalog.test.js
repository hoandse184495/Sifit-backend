const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const User = require('../src/models/user.model');
const Shop = require('../src/models/sellerProfile.model');
const Product = require('../src/models/product.model');
const Category = require('../src/models/category.model');
const Rating = require('../src/models/sellerRating.model');
let mongo, seller, other, shop, categories, products;
const get = (params) =>
  request(app)
    .get(`/api/v1/shops/${shop.shopSlug}`)
    .query(params || {});
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([User.init(), Shop.init(), Product.init(), Category.init(), Rating.init()]);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Shop.deleteMany({}),
    Product.deleteMany({}),
    Category.deleteMany({}),
    Rating.deleteMany({}),
  ]);
  require('../src/middlewares/rateLimit.middleware').apiLimiter.resetKey('::ffff:127.0.0.1');
  [seller, other] = await User.create(
    ['owner', 'other'].map((name) => ({
      fullName: name,
      email: `${name}@shop.test`,
      passwordHash: 'fixture',
      role: 'SELLER',
    })),
  );
  shop = await Shop.create({
    userId: seller._id,
    shopName: 'Sifit Archive',
    shopSlug: 'sifit-archive',
    contactPhone: '0901234567',
  });
  categories = await Category.create([
    { name: 'Áo', slug: 'ao' },
    { name: 'Áo khoác', slug: 'ao-khoac' },
  ]);
  const body = {
    sellerId: seller._id,
    categoryId: categories[0]._id,
    title: 'Cotton shirt',
    description: 'A pre-loved cotton garment',
    price: 100000,
    size: 'M',
    condition: 'GOOD',
    status: 'ACTIVE',
  };
  products = await Product.create(
    Array.from({ length: 37 }, (_, index) => ({
      ...body,
      title:
        index === 29
          ? 'Linen needle 29'
          : index === 30
            ? 'Literal .* design'
            : `Shop shirt ${String(index).padStart(2, '0')}`,
      brand: index === 29 ? 'Arc[Studio]' : 'Sifit',
      price: 50000 + (index % 5) * 10000,
      size: index === 29 ? 'L' : 'M',
      condition: index === 29 ? 'LIKE_NEW' : 'GOOD',
      categoryId: categories[index === 29 ? 1 : 0]._id,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      approvedBy: seller._id,
      rejectionReason: 'Internal fixture note',
    })),
  );
  await Product.create([
    ...['PENDING', 'DRAFT', 'REJECTED', 'SOLD', 'RESERVED', 'ARCHIVED'].map((status) => ({
      ...body,
      status,
      brand: 'PRIVATE_BRAND',
    })),
    { ...body, brand: 'DELETED_BRAND', deletedAt: new Date() },
    { ...body, sellerId: other._id, brand: 'FOREIGN_BRAND' },
  ]);
});

it('paginates every public item beyond the old twenty-product limit with stable ordering', async () => {
  const first = (await get().expect(200)).body.data;
  const second = (await get({ page: 2 }).expect(200)).body.data;
  expect(first.products).toHaveLength(20);
  expect(second.products).toHaveLength(17);
  expect(first.pagination).toMatchObject({ total: 37, pages: 2, page: 1, limit: 20 });
  const ids = [...first.products, ...second.products].map((item) => item._id);
  expect(new Set(ids).size).toBe(37);
  expect(ids).toEqual(
    products
      .map((item) => item.id)
      .sort()
      .reverse(),
  );
  const outside = (await get({ page: 3 }).expect(200)).body.data;
  expect(outside.products).toEqual([]);
  expect(outside.pagination.total).toBe(37);
});

it('looks up the exact public profile by seller without exposing contact or moderation fields', async () => {
  const profile = (await request(app).get(`/api/v1/shops/by-seller/${seller.id}`).expect(200)).body
    .data.shop;
  expect(profile.shopSlug).toBe(shop.shopSlug);
  expect(profile.contactPhone).toBeUndefined();
  const response = (await get({ sellerId: other.id, status: 'DRAFT' }).expect(200)).body.data;
  expect(
    response.products.every((item) => item.sellerId === seller.id && item.status === 'ACTIVE'),
  ).toBe(true);
  expect(response.products[0].approvedBy).toBeUndefined();
  expect(response.products[0].rejectionReason).toBeUndefined();
  await request(app).get('/api/v1/shops/by-seller/invalid').expect(400);
  await request(app).get(`/api/v1/shops/by-seller/${new mongoose.Types.ObjectId()}`).expect(404);
});

it('combines search, category, literal brand, size, condition and inclusive price filters on the server', async () => {
  const response = (
    await get({
      search: 'needle',
      categoryId: categories[1].id,
      brand: 'arc[studio]',
      size: 'L',
      condition: 'LIKE_NEW',
      minPrice: 90000,
      maxPrice: 90000,
    }).expect(200)
  ).body.data;
  expect(response.products.map((item) => item._id)).toEqual([products[29].id]);
  expect(response.pagination.total).toBe(1);
  const literal = (await get({ search: '.*' }).expect(200)).body.data;
  expect(literal.products.map((item) => item._id)).toEqual([products[30].id]);
});

it('computes filter options from all active shop products, including later pages', async () => {
  const response = (await get({ search: 'no-match', limit: 1 }).expect(200)).body.data;
  expect(response.products).toEqual([]);
  expect(response.facets.brands).toEqual(['Arc[Studio]', 'Sifit']);
  expect(response.facets.categories.map((item) => item.name).sort()).toEqual(
    ['Áo', 'Áo khoác'].sort(),
  );
  expect(response.facets.sizes).toEqual(['M', 'L']);
  expect(response.facets.conditions).toEqual(['LIKE_NEW', 'GOOD']);
  expect(response.facets).toMatchObject({ total: 37, minPrice: 50000, maxPrice: 90000 });
  expect(JSON.stringify(response.facets)).not.toMatch(/PRIVATE_BRAND|FOREIGN_BRAND|DELETED_BRAND/);
});

it('sorts prices and dates deterministically across pages', async () => {
  const expected = [...products].sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));
  const first = (await get({ sort: 'price_asc', limit: 10 }).expect(200)).body.data.products;
  const second = (await get({ sort: 'price_asc', limit: 10, page: 2 }).expect(200)).body.data
    .products;
  expect([...first, ...second].map((item) => item._id)).toEqual(
    expected.slice(0, 20).map((item) => item.id),
  );
  const descending = (await get({ sort: 'price_desc', limit: 50 }).expect(200)).body.data.products;
  expect(descending.map((item) => item._id)).toEqual(expected.reverse().map((item) => item.id));
  const oldest = (await get({ sort: 'oldest', limit: 50 }).expect(200)).body.data.products;
  expect(oldest.map((item) => item._id)).toEqual(products.map((item) => item.id).sort());
});

it('rejects invalid pagination, filter values, object injection and reversed price bounds', async () => {
  for (const params of [
    { page: 0 },
    { page: 100001 },
    { limit: 51 },
    { sort: 'unknown' },
    { size: 'INVALID' },
    { condition: 'INVALID' },
    { categoryId: 'bad' },
    { minPrice: -1 },
    { minPrice: 2.5 },
    { minPrice: 100000, maxPrice: 50000 },
    { search: 'x'.repeat(101) },
  ])
    await get(params).expect(400);
  await get({ brand: ['Sifit', 'Other'] }).expect(400);
  const injected = (
    await request(app).get(`/api/v1/shops/${shop.shopSlug}?brand[$ne]=x`).expect(200)
  ).body.data;
  expect(
    injected.products.every((item) => item.sellerId === seller.id && item.status === 'ACTIVE'),
  ).toBe(true);
});

it('returns a valid empty catalogue and no leaked foreign facets for a shop without products', async () => {
  await Shop.create({ userId: other._id, shopName: 'Empty wardrobe', shopSlug: 'empty-wardrobe' });
  await Product.deleteMany({ sellerId: other._id });
  const response = (await request(app).get('/api/v1/shops/empty-wardrobe').expect(200)).body.data;
  expect(response.products).toEqual([]);
  expect(response.pagination).toMatchObject({ total: 0, pages: 0 });
  expect(response.facets).toMatchObject({
    brands: [],
    categories: [],
    sizes: [],
    conditions: [],
    total: 0,
  });
});

it('hides the shop and all products when the profile or seller account is unavailable', async () => {
  await Shop.updateOne({ _id: shop.id }, { status: 'SUSPENDED' });
  await get().expect(404);
  await request(app).get(`/api/v1/shops/by-seller/${seller.id}`).expect(404);
  await Shop.updateOne({ _id: shop.id }, { status: 'ACTIVE' });
  await User.updateOne({ _id: seller.id }, { status: 'SUSPENDED' });
  await get().expect(404);
  await User.updateOne({ _id: seller.id }, { status: 'ACTIVE', role: 'BUYER' });
  await get().expect(404);
});

it('paginates public shop reviews deterministically when timestamps are equal', async () => {
  const ratings = await Rating.create(
    Array.from({ length: 13 }, () => ({
      orderId: new mongoose.Types.ObjectId(),
      buyerId: other._id,
      sellerId: seller._id,
      rating: 4,
      comment: 'Verified fixture review',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    })),
  );
  const first = (
    await request(app).get(`/api/v1/shops/${shop.shopSlug}/ratings?page=1&limit=10`).expect(200)
  ).body.data;
  const second = (
    await request(app).get(`/api/v1/shops/${shop.shopSlug}/ratings?page=2&limit=10`).expect(200)
  ).body.data;
  expect(first.items).toHaveLength(10);
  expect(second.items).toHaveLength(3);
  expect([...first.items, ...second.items].map((item) => item._id)).toEqual(
    ratings
      .map((item) => item.id)
      .sort()
      .reverse(),
  );
});
