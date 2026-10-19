const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const User = require('../src/models/user.model');
const SellerProfile = require('../src/models/sellerProfile.model');
const Product = require('../src/models/product.model');
const Order = require('../src/models/order.model');

// Idempotent: only legacy USER records are changed; no business data is deleted.
async function upgradeRoles({ apply = false } = {}) {
  const sources = await Promise.all([
    SellerProfile.distinct('userId'),
    Product.distinct('sellerId'),
    Order.distinct('sellerId'),
  ]);
  const sellerIds = [...new Map(sources.flat().map((id) => [String(id), id])).values()];
  const sellerFilter = { role: 'USER', _id: { $in: sellerIds } };
  const buyerFilter = { role: 'USER', _id: { $nin: sellerIds } };
  const report = {
    mode: apply ? 'apply' : 'dry-run',
    sellers: await User.countDocuments(sellerFilter),
    buyers: await User.countDocuments(buyerFilter),
    adminsUnchanged: await User.countDocuments({ role: 'ADMIN' }),
  };
  if (apply) {
    // Native collection permits reading legacy roles after the schema upgrade.
    report.sellersUpdated = (
      await User.collection.updateMany(sellerFilter, { $set: { role: 'SELLER' } })
    ).modifiedCount;
    report.buyersUpdated = (
      await User.collection.updateMany(buyerFilter, { $set: { role: 'BUYER' } })
    ).modifiedCount;
  }
  return report;
}

if (require.main === module) {
  (async () => {
    try {
      await connectDatabase();
      console.info(JSON.stringify(await upgradeRoles({ apply: process.argv.includes('--apply') })));
    } catch (error) {
      console.error(`Role upgrade failed: ${error.message}`);
      process.exitCode = 1;
    } finally {
      await disconnectDatabase();
    }
  })();
}

module.exports = { upgradeRoles };
