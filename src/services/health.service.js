const mongoose = require('mongoose');

const connectionStates = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

const getHealthStatus = () => {
  const readyState = mongoose.connection.readyState;
  const database = connectionStates[readyState] || 'unknown';

  return {
    status: database === 'connected' ? 'ok' : 'degraded',
    database,
  };
};

module.exports = {
  getHealthStatus,
};
