const { connectDatabase, disconnectDatabase } = require('../config/database');
const deliveryService = require('../services/delivery.service');
const logger = require('../utils/logger');

const run = async () => {
  await connectDatabase();
  try {
    const result = await deliveryService.completeEligibleOrders();
    logger.info(`Delivery completion completed. Completed orders: ${result.completedCount}`);
  } finally {
    await disconnectDatabase();
  }
};

run()
  .then(() => process.exit(0))
  .catch(async (error) => {
    logger.error(`Delivery completion failed: ${error.message}`);
    await disconnectDatabase();
    process.exit(1);
  });
