const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../src/app');

const setMongoReadyState = (readyState) => {
  Object.defineProperty(mongoose.connection, 'readyState', {
    configurable: true,
    value: readyState,
  });
};

describe('SIFIT API foundation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete mongoose.connection.readyState;
  });

  it('returns a successful health check when MongoDB is connected', async () => {
    setMongoReadyState(1);

    const response = await request(app).get('/api/v1/health').expect(200);

    expect(response.body).toEqual({
      success: true,
      message: 'SIFIT API is running',
      data: {
        status: 'ok',
        database: 'connected',
      },
    });
  });

  it('returns 404 for unknown routes', async () => {
    const response = await request(app).get('/api/v1/does-not-exist').expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Route not found: /api/v1/does-not-exist');
    expect(response.body.errors).toEqual([]);
  });

  it('uses the centralized error response format when MongoDB is unavailable', async () => {
    setMongoReadyState(0);

    const response = await request(app).get('/api/v1/health').expect(503);

    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Database is not connected');
    expect(response.body.errors).toEqual([
      {
        field: 'database',
        message: 'MongoDB connection is disconnected',
      },
    ]);
  });
});
