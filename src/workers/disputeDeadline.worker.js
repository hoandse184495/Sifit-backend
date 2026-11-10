const { connectDatabase, disconnectDatabase } = require('../config/database');
const logger = require('../utils/logger');

const run = async () => {
  await connectDatabase();
  try {
    logger.info('Deadline worker completed', await require('../services/deadline.service').run());
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
