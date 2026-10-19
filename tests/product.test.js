jest.mock('../src/config/cloudinary', () => ({
  uploadBuffer: jest.fn(async () => ({
    secure_url: 'https://res.cloudinary.com/test/image/upload/sample.png',
    public_id: `sifit/products/test-${Date.now()}-${Math.random()}`,
  })),
  deleteAsset: jest.fn(async () => ({ result: 'ok' })),
}));

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const roles = require('../src/constants/roles');
const Category = require('../src/models/category.model');
const Product = require('../src/models/product.model');
const User = require('../src/models/user.model');
const cloudinary = require('../src/config/cloudinary');

let mongoServer;
let category;

const pngBuffer = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

const registerAndLogin = async (email, role = roles.BUYER) => {
  const password = 'StrongPassword123!';

  await request(app)
    .post('/api/v1/auth/register')
    .send({
      fullName: email.split('@')[0],
      email,
      password,
    })
    .expect(201);

  if (role !== roles.BUYER) {
    await User.updateOne({ email }, { role });
  }

  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({
      email,
      password,
    })
    .expect(200);

  const user = await User.findOne({ email });

  return {
    accessToken: response.body.data.accessToken,
    user,
  };
};

const validProductBody = () => ({
  title: 'Vintage denim jacket',
  description: 'A clean second-hand denim jacket in good condition.',
  price: 250000,
  categoryId: category.id,
  brand: 'Levis',
  size: 'M',
  color: 'Blue',
  condition: 'GOOD',
});

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([User.init(), Category.init(), Product.init()]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Category.deleteMany({}), Product.deleteMany({})]);
  category = await Category.create({ name: 'Áo khoác', slug: 'ao-khoac' });
  jest.clearAllMocks();
});

describe('Product API', () => {
  it('creates a product successfully', async () => {
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);

    const response = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send(validProductBody())
      .expect(201);

    expect(response.body.data.product.status).toBe('DRAFT');
    expect(response.body.data.product.sellerId).toBe(String(seller.user._id));
  });

  it('requires authentication to create a product', async () => {
    await request(app).post('/api/v1/products').send(validProductBody()).expect(401);
  });

  it('does not allow sellerId spoofing', async () => {
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const other = await registerAndLogin('other@example.com', roles.SELLER);

    const response = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ ...validProductBody(), sellerId: other.user.id })
      .expect(201);

    expect(response.body.data.product.sellerId).toBe(String(seller.user._id));
  });

  it('public listing only returns active non-deleted products', async () => {
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    await Product.create({ ...validProductBody(), sellerId: seller.user._id, status: 'DRAFT' });
    await Product.create({ ...validProductBody(), sellerId: seller.user._id, status: 'ACTIVE' });
    await Product.create({
      ...validProductBody(),
      title: 'Deleted active jacket',
      sellerId: seller.user._id,
      status: 'ACTIVE',
      deletedAt: new Date(),
    });

    const response = await request(app).get('/api/v1/products').expect(200);

    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].status).toBe('ACTIVE');
  });

  it('owner can view own drafts', async () => {
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    await Product.create({ ...validProductBody(), sellerId: seller.user._id, status: 'DRAFT' });

    const response = await request(app)
      .get('/api/v1/products/my')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);

    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].status).toBe('DRAFT');
  });

  it('prevents other users from editing products', async () => {
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const other = await registerAndLogin('other@example.com', roles.SELLER);
    const product = await Product.create({ ...validProductBody(), sellerId: seller.user._id });

    await request(app)
      .patch(`/api/v1/products/${product.id}`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .send({ title: 'Updated title' })
      .expect(403);
  });

  it('rejects invalid prices', async () => {
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);

    await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ ...validProductBody(), price: 12.5 })
      .expect(400);
  });

  it('supports search, filtering, and pagination', async () => {
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    await Product.create({
      ...validProductBody(),
      title: 'Vintage denim jacket',
      sellerId: seller.user._id,
      status: 'ACTIVE',
    });
    await Product.create({
      ...validProductBody(),
      title: 'Black cotton shirt',
      brand: 'Other',
      sellerId: seller.user._id,
      status: 'ACTIVE',
    });

    const response = await request(app)
      .get('/api/v1/products')
      .query({
        search: 'denim',
        categoryId: category.id,
        condition: 'GOOD',
        size: 'M',
        brand: 'Levis',
        minPrice: 100000,
        maxPrice: 300000,
        page: 1,
        limit: 1,
        sort: 'price_asc',
      })
      .expect(200);

    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.pagination.total).toBe(1);
  });

  it('requires images before submit and allows valid submit', async () => {
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const product = await Product.create({ ...validProductBody(), sellerId: seller.user._id });

    await request(app)
      .post(`/api/v1/products/${product.id}/submit`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(400);

    product.images.push({ url: 'https://example.com/a.png', publicId: 'sifit/products/a' });
    await product.save();

    const response = await request(app)
      .post(`/api/v1/products/${product.id}/submit`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);

    expect(response.body.data.product.status).toBe('PENDING');
  });

  it('soft deletes products', async () => {
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const product = await Product.create({ ...validProductBody(), sellerId: seller.user._id });

    await request(app)
      .delete(`/api/v1/products/${product.id}`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);

    const deleted = await Product.findById(product.id);
    expect(deleted.deletedAt).toBeInstanceOf(Date);
  });

  it('validates image content type and size', async () => {
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const product = await Product.create({ ...validProductBody(), sellerId: seller.user._id });

    await request(app)
      .post(`/api/v1/products/${product.id}/images`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .attach('images', Buffer.from('not an image'), 'bad.txt')
      .expect(415);

    await request(app)
      .post(`/api/v1/products/${product.id}/images`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .attach('images', Buffer.alloc(5 * 1024 * 1024 + 1), 'large.png')
      .expect(413);
  });

  it('enforces upload ownership and image limit protection', async () => {
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const other = await registerAndLogin('other@example.com', roles.SELLER);
    const product = await Product.create({
      ...validProductBody(),
      sellerId: seller.user._id,
      images: Array.from({ length: 7 }, (_, index) => ({
        url: `https://example.com/${index}.png`,
        publicId: `sifit/products/${index}`,
      })),
    });

    await request(app)
      .post(`/api/v1/products/${product.id}/images`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .attach('images', pngBuffer, 'one.png')
      .expect(403);

    await request(app)
      .post(`/api/v1/products/${product.id}/images`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .attach('images', pngBuffer, 'one.png')
      .attach('images', pngBuffer, 'two.png')
      .expect(409);

    expect(cloudinary.uploadBuffer).not.toHaveBeenCalled();
  });
});

describe('Admin moderation and categories', () => {
  it('admin approves pending products and rejects invalid transitions', async () => {
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const admin = await registerAndLogin('admin@example.com', roles.ADMIN);
    const pending = await Product.create({
      ...validProductBody(),
      sellerId: seller.user._id,
      status: 'PENDING',
      images: [{ url: 'https://example.com/a.png', publicId: 'sifit/products/a' }],
    });
    const draft = await Product.create({ ...validProductBody(), sellerId: seller.user._id });

    const response = await request(app)
      .patch(`/api/v1/admin/products/${pending.id}/approve`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(response.body.data.product.status).toBe('ACTIVE');

    await request(app)
      .patch(`/api/v1/admin/products/${draft.id}/approve`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(409);
  });

  it('rejects non-admin moderation and allows admin rejection', async () => {
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const admin = await registerAndLogin('admin@example.com', roles.ADMIN);
    const pending = await Product.create({
      ...validProductBody(),
      sellerId: seller.user._id,
      status: 'PENDING',
      images: [{ url: 'https://example.com/a.png', publicId: 'sifit/products/a' }],
    });

    await request(app)
      .patch(`/api/v1/admin/products/${pending.id}/reject`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ reason: 'Product images are unclear' })
      .expect(403);

    const response = await request(app)
      .patch(`/api/v1/admin/products/${pending.id}/reject`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ reason: 'Product images are unclear' })
      .expect(200);

    expect(response.body.data.product.status).toBe('REJECTED');
    expect(response.body.data.product.rejectionReason).toBe('Product images are unclear');
  });

  it('requires admin role for category CRUD', async () => {
    const user = await registerAndLogin('user@example.com');
    const admin = await registerAndLogin('admin@example.com', roles.ADMIN);

    await request(app)
      .post('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ name: 'Túi xách' })
      .expect(403);

    const createResponse = await request(app)
      .post('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ name: 'Túi xách' })
      .expect(201);

    await request(app)
      .patch(`/api/v1/admin/categories/${createResponse.body.data.category._id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ description: 'Bags and purses' })
      .expect(200);
  });
});
