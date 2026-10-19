const { connectDatabase, disconnectDatabase } = require('../config/database');
const logger = require('../utils/logger');

const run = async () => {
  await connectDatabase();
  try {
    logger.info(
      'Shipment reconciliation completed. Simulator provider has no external polling source.',
    );
  } finally {
    await disconnectDatabase();
  }
};

run()
  .then(() => process.exit(0))
  .catch(async (error) => {
    logger.error(`Shipment reconciliation failed: ${error.message}`);
    await disconnectDatabase();
    process.exit(1);
  });
