const http = require('http');
const app = require('./app');
const env = require('./config/env');
const { connectDatabase, disconnectDatabase } = require('./config/database');
const { initSocket, closeSocket } = require('./socket');
const { startBackgroundJobs } = require('./services/backgroundJob.service');
const logger = require('./utils/logger');

let server;
let backgroundJobs;
let isShuttingDown = false;

const shutdown = async (signal) => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info(`${signal} received. Shutting down gracefully...`);

  try {
    // Finish active jobs before closing their database/socket dependencies.
    await backgroundJobs?.stop();
    await closeSocket();
    if (server?.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      logger.info('HTTP server closed');
    }

    await disconnectDatabase();
    process.exit(0);
  } catch (error) {
    logger.error(`Graceful shutdown failed: ${error.message}`);
    process.exit(1);
  }
};

const startServer = async () => {
  try {
    await connectDatabase();

    server = http.createServer(app);
    initSocket(server);

    server.listen(env.PORT, () => {
      logger.info(`SIFIT API listening on port ${env.PORT}`);
      backgroundJobs = startBackgroundJobs();
    });
  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

startServer();
