const mongoose = require('mongoose');
const env = require('./env');
const logger = require('../utils/logger');

const connectDatabase = async () => {
  try {
    await mongoose.connect(env.MONGODB_URI, {
      autoIndex: env.NODE_ENV !== 'production',
    });

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
