const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const env = require('../src/config/env');
const prepareDatabase = require('../scripts/prepareDatabase');
const bootstrapAdmin = require('../scripts/bootstrapAdmin');

it('prepares all model indexes repeatedly without removing stored data', async () => {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const previousURI = env.MONGODB_URI;
  env.MONGODB_URI = mongo.getUri();
  try {
    await prepareDatabase();
    await mongoose.connect(env.MONGODB_URI);
    await mongoose.connection.collection('release_sentinel').insertOne({ keep: true });
    await mongoose.disconnect();
    await prepareDatabase();
    await mongoose.connect(env.MONGODB_URI);
    expect(await mongoose.connection.collection('release_sentinel').countDocuments({ keep: true })).toBe(1);
    const indexes = await mongoose.connection.collection('users').indexes();
    expect(indexes.some(index => index.unique && index.key.email === 1)).toBe(true);
    await mongoose.disconnect();
    process.env.ADMIN_BOOTSTRAP_EMAIL = 'admin@release.test';
    process.env.ADMIN_BOOTSTRAP_PASSWORD = 'ReleaseDemo123!';
    await bootstrapAdmin();
    await mongoose.connect(env.MONGODB_URI);
    expect(await mongoose.models.User.countDocuments({ role: 'ADMIN', email: 'admin@release.test' })).toBe(1);
    await mongoose.disconnect();
    await expect(bootstrapAdmin()).rejects.toThrow('An admin already exists');
  } finally {
    delete process.env.ADMIN_BOOTSTRAP_EMAIL; delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
    await mongoose.disconnect(); env.MONGODB_URI = previousURI; await mongo.stop();
  }
});
