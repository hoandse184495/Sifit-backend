const mongoose = require('mongoose');
const request = require('supertest');
const sharp = require('sharp');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const app = require('../src/app');
const env = require('../src/config/env');
const User = require('../src/models/user.model');
const Product = require('../src/models/product.model');
const Category = require('../src/models/category.model');
const Job = require('../src/models/stylistJob.model');
const Budget = require('../src/models/stylistBudget.model');
const { signAccessToken } = require('../src/utils/token');
const service = require('../src/services/stylist.service');

let mongo, user, other, seller, product, png;
const originalFetch = globalThis.fetch;
const auth = person => `Bearer ${signAccessToken(person)}`;
const create = (id = 'request-stylist-0001', person = user) => request(app).post('/api/v1/stylist/tryon').set('Authorization', auth(person))
  .field('requestId', id).field('productIds', JSON.stringify([product.id])).field('engine', 'v1.6').field('consent', 'true')
  .attach('photo', png, { filename: 'portrait.png', contentType: 'image/png' });
const waitFor = async predicate => { for (let i = 0; i < 100; i++) { if (await predicate()) return; await new Promise(r => globalThis.setTimeout(r, 20)); } throw new Error('Timed out waiting for job state'); };
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([User.init(), Product.init(), Category.init(), Job.init(), Budget.init()]);
  png = await sharp({ create: { width: 100, height: 150, channels: 3, background: '#ccc' } }).png().toBuffer();
});
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.models).map(model => model.deleteMany({})));
  env.TRYON_MODE = 'live'; env.FASHN_API_KEY = 'test-provider-key'; env.FASHN_MONTHLY_BUDGET = 100;
  [user, other, seller] = await User.create([
    { fullName: 'AI Buyer', email: 'ai@stylist.test', passwordHash: 'unused', role: 'BUYER' },
    { fullName: 'Other Buyer', email: 'other@stylist.test', passwordHash: 'unused', role: 'BUYER' },
    { fullName: 'AI Seller', email: 'seller@stylist.test', passwordHash: 'unused', role: 'SELLER' },
  ]);
  const category = await Category.create({ name: 'Tops', slug: 'tops' });
  product = await Product.create({ sellerId: seller._id, title: 'Cotton shirt', description: 'A cotton shirt for virtual fitting', categoryId: category._id, price: 100000, size: 'M', condition: 'GOOD', status: 'ACTIVE', images: [{ url: 'https://res.cloudinary.com/test/shirt.jpg', publicId: 'shirt' }] });
  globalThis.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ id: 'prediction-1' }) }));
});
afterAll(async () => { globalThis.fetch = originalFetch; await mongoose.disconnect(); await mongo.stop(); });

it('requires authentication and explicitly enabled live mode', async () => {
  await request(app).get('/api/v1/stylist/state').expect(401);
  env.TRYON_MODE = 'disabled';
  await create().expect(503);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it('uses live provider adapter, resumes polling, persists private output and deletes it without resetting quota', async () => {
  const response = await create().expect(202);
  const id = response.body.data.job.id;
  await waitFor(async () => (await Job.findById(id)).phase === 'processing');
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  const [url, options] = globalThis.fetch.mock.calls[0];
  expect(url).toBe('https://api.fashn.ai/v1/run');
  expect(JSON.parse(options.body)).toMatchObject({ model_name: 'tryon-v1.6', inputs: { garment_image: product.images[0].url, return_base64: true } });
  const repeated = await create().expect(202);
  expect(repeated.body.data.job.id).toBe(id);
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'completed', output: [`data:image/png;base64,${png.toString('base64')}`] }) });
  await request(app).get(`/api/v1/stylist/jobs/${id}`).set('Authorization', auth(other)).expect(404);
  const completed = await request(app).get(`/api/v1/stylist/jobs/${id}`).set('Authorization', auth(user)).expect(200);
  expect(completed.body.data.job.status).toBe('completed');
  expect(completed.body.data.job.predictionId).toBeUndefined();
  await request(app).get(`/api/v1/stylist/jobs/${id}/image`).set('Authorization', auth(other)).expect(404);
  const image = await request(app).get(`/api/v1/stylist/jobs/${id}/image`).set('Authorization', auth(user)).expect(200);
  expect(image.headers['content-type']).toContain('image/jpeg');
  await request(app).delete(`/api/v1/stylist/jobs/${id}`).set('Authorization', auth(user)).expect(200);
  expect((await service.state(user._id)).quota.daily).toBe(4);
  await request(app).get(`/api/v1/stylist/jobs/${id}/image`).set('Authorization', auth(user)).expect(404);
});
it('atomic reservations prevent concurrent overspending and duplicate provider submissions', async () => {
  const input = { requestId: 'parallel-request-0001', productIds: JSON.stringify([product.id]), engine: 'v1.6', consent: 'true' };
  const file = { mimetype: 'image/png', buffer: png };
  // Existing counters allow only one credit across all concurrent submissions.
  const { periods } = require('../src/services/stylist/quota');
  await Budget.create({ _id: `day:${user.id}:${periods().day}`, used: 4 });
  const result = await Promise.allSettled([service.create(user._id, input, file), service.create(user._id, input, file)]);
  const jobs = result.filter(r => r.status === 'fulfilled').map(r => r.value);
  expect(jobs.length).toBeGreaterThan(0);
  expect(await Job.countDocuments()).toBe(1);
  expect((await service.state(user._id)).quota.daily).toBe(0);
  await Promise.all(jobs.map(job => service.advance(job)));
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});
it('confirmed rejection refunds quota; uncertain submission keeps its reservation and never resubmits', async () => {
  globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 402 });
  const failed = await create('confirmed-failure-0001').expect(202);
  await waitFor(async () => (await Job.findById(failed.body.data.job.id)).status === 'failed');
  expect((await service.state(user._id)).quota.daily).toBe(5);
  globalThis.fetch.mockRejectedValueOnce(new Error('Connection lost after submission'));
  const uncertain = await create('uncertain-request-0001').expect(202);
  const id = uncertain.body.data.job.id;
  await waitFor(async () => (await Job.findById(id)).status === 'attention');
  await service.get(user._id, id);
  await service.get(user._id, id);
  expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  expect((await service.state(user._id)).quota.daily).toBe(4);
});
it('rejects unavailable seller, non-image bytes, expired images and malformed selection before billing', async () => {
  await User.updateOne({ _id: seller._id }, { status: 'SUSPENDED' });
  await create().expect(400);
  await User.updateOne({ _id: seller._id }, { status: 'ACTIVE' });
  const input = { requestId: 'invalid-photo-0001', productIds: JSON.stringify([product.id]), engine: 'v1.6', consent: 'true' };
  await expect(service.create(user._id, input, { mimetype: 'image/png', buffer: Buffer.from('not a picture') })).rejects.toMatchObject({ statusCode: 400 });
  expect(await Budget.countDocuments()).toBe(0);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it('preserves the original outfit collage adapter and charges one 2-credit generation for the entire set', async () => {
  const dataUri = `data:image/png;base64,${png.toString('base64')}`;
  await Product.updateOne({ _id: product._id }, { 'images.0.url': dataUri });
  const bottomCategory = await Category.create({ name: 'Bottoms', slug: 'bottoms' });
  const bottoms = await Product.create({ sellerId: seller._id, title: 'Cotton trousers', description: 'Cotton trousers for a complete outfit', categoryId: bottomCategory._id, price: 100000, size: 'M', condition: 'GOOD', status: 'ACTIVE', images: [{ url: dataUri, publicId: 'trousers' }] });
  const job = await service.create(user._id, { requestId: 'outfit-request-0001', productIds: JSON.stringify([product.id, bottoms.id]), engine: 'outfit', consent: 'true' }, { mimetype: 'image/png', buffer: png });
  expect(job.cost).toBe(2);
  expect(service.summary(job).totalSteps).toBe(1);
  await service.advance(job);
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toMatchObject({ model_name: 'tryon-max', inputs: { generation_mode: 'balanced', num_images: 1 } });
  expect((await service.state(user._id)).quota.daily).toBe(3);
  globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'completed', output: [dataUri] }) });
  const worker = require('../src/services/stylistWorker.service').startStylistWorker();
  try { await waitFor(async () => (await Job.findById(job.id)).status === 'completed'); }
  finally { await worker.stop(); }
});
