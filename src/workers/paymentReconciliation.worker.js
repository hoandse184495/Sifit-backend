const { connectDatabase, disconnectDatabase } = require('../config/database');
const paymentService = require('../services/payment.service');
const logger = require('../utils/logger');

const run = async () => {
  await connectDatabase();
  try {
    const result = await paymentService.expirePendingPayments();
    logger.info(`Payment reconciliation completed. Expired payments: ${result.expiredCount}`);
  } finally {
    await disconnectDatabase();
  }
};

run()
  .then(() => process.exit(0))
  .catch(async (error) => {
    logger.error(`Payment reconciliation failed: ${error.message}`);
    await disconnectDatabase();
    process.exit(1);
  });
