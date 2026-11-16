// Explicit, paid smoke test. Uses a disposable replica set, never the configured app DB.
const process = require('node:process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
if (process.env.SIFIT_LIVE_TEST !== 'true') throw new Error('Set SIFIT_LIVE_TEST=true to authorize one paid FASHN generation.');
process.env.NODE_ENV = 'test';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const env = require('../src/config/env');
const User = require('../src/models/user.model');
const Category = require('../src/models/category.model');
const Product = require('../src/models/product.model');
const Job = require('../src/models/stylistJob.model');
const service = require('../src/services/stylist.service');
async function run() {
  const photoPath = process.argv[2];
  const garment = process.argv[3];
  if (!photoPath || !garment?.startsWith('https://') || !env.FASHN_API_KEY) throw new Error('Provide a portrait path, HTTPS garment URL, and backend FASHN_API_KEY.');
  env.TRYON_MODE = 'live';
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  try {
    await mongoose.connect(mongo.getUri());
    const [buyer, seller] = await User.create([
      { fullName: 'Live Test Buyer', email: 'buyer@live-test.invalid', passwordHash: 'unused', role: 'BUYER' },
      { fullName: 'Live Test Seller', email: 'seller@live-test.invalid', passwordHash: 'unused', role: 'SELLER' },
    ]);
    const category = await Category.create({ name: 'Tops', slug: 'tops' });
    const product = await Product.create({ sellerId: seller._id, title: 'Live fitting shirt', description: 'Temporary paid smoke test product', categoryId: category._id, price: 100000, size: 'M', condition: 'GOOD', status: 'ACTIVE', images: [{ url: garment, publicId: 'smoke-test-only' }] });
    await Job.init();
    const job = await service.create(buyer._id, { requestId: 'explicit-live-smoke-test-0001', productIds: JSON.stringify([product.id]), engine: 'v1.6', consent: 'true' }, { buffer: await fs.readFile(photoPath), mimetype: 'image/png' });
    console.log('Submitting exactly one live tryon-v1.6 generation (1 credit).');
    await service.advance(job);
    for (let i = 0; i < 180; i++) {
      const current = await service.get(buyer._id, job.id);
      if (current.status === 'completed') {
        const stored = await Job.findById(job.id).select('+output');
        const directory = path.resolve('artifacts/stylist-live');
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(path.join(directory, 'result.jpg'), stored.output);
        console.log(JSON.stringify({ status: current.status, model: 'tryon-v1.6', steps: current.step, quota: (await service.state(buyer._id)).quota, result: path.join(directory, 'result.jpg') }));
        return;
      }
      if (['failed', 'attention'].includes(current.status)) throw new Error(current.error);
      if (i % 10 === 0) console.log(JSON.stringify({ status: current.status, phase: current.phase, completedSteps: current.step }));
      await delay(2500);
    }
    throw new Error('Live test timed out. No second generation was submitted.');
  } finally { await mongoose.disconnect(); await mongo.stop(); }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
