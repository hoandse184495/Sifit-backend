const { connectDatabase, disconnectDatabase } = require('../config/database');
const logger = require('../utils/logger');
const { expireReservations } = require('../services/reservation.service');

const run = async () => {
  await connectDatabase();

  try {
    const result = await expireReservations();
    logger.info(`Reservation expiry completed. Expired groups: ${result.expiredCount}`);
  } finally {
    await disconnectDatabase();
  }
};

run()
  .then(() => process.exit(0))
  .catch(async (error) => {
    logger.error(`Reservation expiry failed: ${error.message}`);
    await disconnectDatabase();
    process.exit(1);
  });
