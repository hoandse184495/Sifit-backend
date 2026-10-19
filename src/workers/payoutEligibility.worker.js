const { connectDatabase, disconnectDatabase } = require('../config/database');
const payoutService = require('../services/payout.service');
const logger = require('../utils/logger');

const run = async () => {
  await connectDatabase();
  try {
    const result = await payoutService.evaluateEligiblePayouts();
    logger.info(`Payout eligibility completed. Evaluated payouts: ${result.evaluatedCount}`);
  } finally {
    await disconnectDatabase();
  }
};

run()
  .then(() => process.exit(0))
  .catch(async (error) => {
    logger.error(`Payout eligibility failed: ${error.message}`);
    await disconnectDatabase();
    process.exit(1);
  });
