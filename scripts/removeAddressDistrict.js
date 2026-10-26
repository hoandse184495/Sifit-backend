const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../src/config/database');

// Use native collections because these legacy fields are no longer in schemas.
const targets = [
  { collection: 'addresses', paths: ['district'] },
  { collection: 'orders', paths: ['shippingAddress.district'] },
  {
    collection: 'shipments',
    paths: ['pickupAddressSnapshot.district', 'deliveryAddressSnapshot.district'],
  },
];

async function removeAddressDistrict({ apply = false } = {}) {
  const report = { mode: apply ? 'apply' : 'dry-run', collections: [] };
  for (const { collection, paths } of targets) {
    const records = mongoose.connection.db.collection(collection);
    const filter = { $or: paths.map((path) => ({ [path]: { $exists: true } })) };
    const matched = await records.countDocuments(filter);
    const result = { collection, matched };
    if (apply) {
      const update = { $unset: Object.fromEntries(paths.map((path) => [path, ''])) };
      result.modified = (await records.updateMany(filter, update)).modifiedCount;
      result.remaining = await records.countDocuments(filter);
    }
    report.collections.push(result);
  }
  return report;
}

if (require.main === module) {
  (async () => {
    try {
      await connectDatabase();
      console.info(JSON.stringify(await removeAddressDistrict({ apply: process.argv.includes('--apply') })));
    } catch (error) {
      console.error(`Address district removal failed: ${error.message}`);
      process.exitCode = 1;
    } finally {
      await disconnectDatabase();
    }
  })();
}

module.exports = { removeAddressDistrict };
