const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../src/config/database');

// Add missing indexes only. Never drop existing indexes or rewrite customer data.
const prepareDatabase = async () => {
  const modelsDir = path.join(__dirname, '../src/models');
  for (const file of fs.readdirSync(modelsDir).filter(file => file.endsWith('.model.js'))) {
    require(path.join(modelsDir, file));
  }
  await connectDatabase();
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!hello.setName && hello.msg !== 'isdbgrid') throw new Error('MongoDB must support transactions: use a replica set or sharded cluster');
    if (!hello.isWritablePrimary) throw new Error('MongoDB has no writable primary');
    for (const model of Object.values(mongoose.models)) {
      await model.createIndexes();
      console.info(`Indexes ready: ${model.modelName}`);
    }
  } finally {
    await disconnectDatabase();
  }
};

if (require.main === module) prepareDatabase().catch(() => {
  // Provider/driver errors can contain credentials. Inspect the DB privately if needed.
  console.error('Database preparation failed. Check replica set, permissions and duplicate data before retrying.');
  process.exitCode = 1;
});
module.exports = prepareDatabase;
