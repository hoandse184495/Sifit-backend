const { connectDatabase, disconnectDatabase } = require('../config/database');
const logger = require('../utils/logger');

const run = async () => {
  await connectDatabase();
  try {
    logger.info(
      'Dispute deadline worker completed. No automatic dispute closure policy is enabled yet.',
    );
  } finally {
    await disconnectDatabase();
  }
};

run()
  .then(() => process.exit(0))
  .catch(async (error) => {
    logger.error(`Dispute deadline worker failed: ${error.message}`);
    await disconnectDatabase();
    process.exit(1);
  });
