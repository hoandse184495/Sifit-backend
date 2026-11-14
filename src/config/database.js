const mongoose = require('mongoose');
const env = require('./env');
const logger = require('../utils/logger');

let transactionsSupported = true;
const originalStartSession = mongoose.startSession.bind(mongoose);

mongoose.startSession = async function patchedStartSession(...args) {
  const session = await originalStartSession(...args);
  const originalWithTransaction = session.withTransaction.bind(session);

  session.withTransaction = async function patchedWithTransaction(fn, options) {
    if (!transactionsSupported) {
      return fn(session);
    }
    try {
      return await originalWithTransaction(fn, options);
    } catch (error) {
      if (
        error?.code === 20 ||
        /Transaction numbers are only allowed on a replica set member or mongos/i.test(
          error?.message || '',
        )
      ) {
        transactionsSupported = false;
        logger.warn(
          'Standalone MongoDB detected: running session operations without replica-set transactions',
        );
        return fn(session);
      }
      throw error;
    }
  };

  return session;
};

const connectDatabase = async () => {
  try {
    await mongoose.connect(env.MONGODB_URI, {
      autoIndex: env.NODE_ENV !== 'production',
    });

    try {
      const hello = await mongoose.connection.db.admin().command({ hello: 1 });
      transactionsSupported = Boolean(hello?.setName || hello?.msg === 'isdbgrid');
      if (!transactionsSupported) {
        logger.info('MongoDB connected in standalone mode (transactions fallback enabled)');
      }
    } catch (_err) {
      // Fallback detection will also trigger dynamically if code 20 is thrown
    }

    logger.info(`MongoDB connected: ${mongoose.connection.host}`);
  } catch (error) {
    logger.error(`MongoDB connection failed: ${error.message}`);
    throw error;
  }
};

const disconnectDatabase = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
  }
};

module.exports = {
  connectDatabase,
  disconnectDatabase,
};
