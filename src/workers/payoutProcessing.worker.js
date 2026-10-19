const { connectDatabase, disconnectDatabase } = require('../config/database');
const payoutService = require('../services/payout.service');
const logger = require('../utils/logger');

const run = async () => {
  await connectDatabase();
  try {
    const result = await payoutService.processApprovedPayouts();
    logger.info(`Payout processing completed. Processed payouts: ${result.processedCount}`);
  } finally {
    await disconnectDatabase();
  }
};

run()
  .then(() => process.exit(0))
  .catch(async (error) => {
    logger.error(`Payout processing failed: ${error.message}`);
    await disconnectDatabase();
    process.exit(1);
  });
