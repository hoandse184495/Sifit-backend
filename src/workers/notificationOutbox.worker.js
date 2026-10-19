const { connectDatabase, disconnectDatabase } = require('../config/database');
const notificationEventService = require('../services/notificationEvent.service');
const logger = require('../utils/logger');

const run = async () => {
  await connectDatabase();
  const result = await notificationEventService.processBatch();
  logger.info(`Notification outbox processed ${result.processed}/${result.scanned} events`);
  await disconnectDatabase();
};

if (require.main === module) {
  run().catch(async (error) => {
    logger.error(`Notification outbox worker failed: ${error.message}`);
    await disconnectDatabase();
    process.exit(1);
  });
}

module.exports = { run };
