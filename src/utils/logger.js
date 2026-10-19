const env = require('../config/env');

const logger = {
  info(message, meta) {
    if (meta) {
      console.info(`[INFO] ${message}`, meta);
      return;
    }

    console.info(`[INFO] ${message}`);
  },

  warn(message, meta) {
    if (meta) {
      console.warn(`[WARN] ${message}`, meta);
      return;
    }

    console.warn(`[WARN] ${message}`);
  },

  error(message, meta) {
    if (meta && env.NODE_ENV !== 'test') {
      console.error(`[ERROR] ${message}`, meta);
      return;
    }

    if (env.NODE_ENV !== 'test') {
      console.error(`[ERROR] ${message}`);
    }
  },
};

module.exports = logger;
