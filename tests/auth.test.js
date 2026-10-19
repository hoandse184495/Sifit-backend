const express = require('express');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const argon2 = require('argon2');
const app = require('../src/app');
const errorHandler = require('../src/middlewares/error.middleware');
const authorize = require('../src/middlewares/authorize.middleware');
const roles = require('../src/constants/roles');
const AuthSession = require('../src/models/authSession.model');
const User = require('../src/models/user.model');

let mongoServer;

const validUser = {
  fullName: 'Nguyen Van A',
  email: 'user@example.com',
  password: 'StrongPassword123!',
};

const getRefreshCookie = (response) => response.headers['set-cookie'][0].split(';')[0];

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await User.init();
  await AuthSession.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await User.deleteMany({});
  await AuthSession.deleteMany({});
});

describe('Authentication API', () => {
  it('registers a user successfully', async () => {
    const response = await request(app).post('/api/v1/auth/register').send(validUser).expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.user.email).toBe(validUser.email);
    expect(response.body.data.user.role).toBe(roles.BUYER);
    expect(response.body.data.user.passwordHash).toBeUndefined();
  });

  it('rejects duplicate email registration', async () => {
    await request(app).post('/api/v1/auth/register').send(validUser).expect(201);

    const response = await request(app).post('/api/v1/auth/register').send(validUser).expect(409);

    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Email is already registered');
  });

  it('rejects invalid registration input', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        fullName: '',
        email: 'not-an-email',
        password: 'weak',
      })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Invalid request data');
    expect(response.body.errors.length).toBeGreaterThan(0);
  });

  it('logs in successfully and stores refresh token in an HttpOnly cookie', async () => {
    await request(app).post('/api/v1/auth/register').send(validUser).expect(201);

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: validUser.email,
        password: validUser.password,
      })
      .expect(200);

    expect(response.body.data.accessToken).toEqual(expect.any(String));
    expect(response.body.data.refreshToken).toBeUndefined();
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
  });

  it('rejects invalid login credentials', async () => {
    await request(app).post('/api/v1/auth/register').send(validUser).expect(201);

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: validUser.email,
        password: 'WrongPassword123!',
      })
      .expect(401);

    expect(response.body.message).toBe('Invalid email or password');
  });

  it('rejects suspended user login', async () => {
    await User.create({
      fullName: 'Suspended User',
      email: 'suspended@example.com',
      passwordHash: await argon2.hash(validUser.password, { type: argon2.argon2id }),
      status: 'SUSPENDED',
    });

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'suspended@example.com',
        password: validUser.password,
      })
      .expect(403);

    expect(response.body.message).toBe('Account is suspended');
  });

  it('rejects /me without authentication', async () => {
    const response = await request(app).get('/api/v1/auth/me').expect(401);

    expect(response.body.message).toBe('Access token is required');
  });

  it('returns /me with a valid access token', async () => {
    await request(app).post('/api/v1/auth/register').send(validUser).expect(201);
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: validUser.email,
        password: validUser.password,
      })
      .expect(200);

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${loginResponse.body.data.accessToken}`)
      .expect(200);

    expect(response.body.data.user.email).toBe(validUser.email);
    expect(response.body.data.user.passwordHash).toBeUndefined();
  });

  it('rotates refresh tokens', async () => {
    await request(app).post('/api/v1/auth/register').send(validUser).expect(201);
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: validUser.email,
        password: validUser.password,
      })
      .expect(200);

    const firstCookie = getRefreshCookie(loginResponse);
    const response = await request(app)
      .post('/api/v1/auth/refresh-token')
      .set('Cookie', firstCookie)
      .expect(200);

    expect(response.body.data.accessToken).toEqual(expect.any(String));
    expect(getRefreshCookie(response)).not.toBe(firstCookie);
    expect(await AuthSession.countDocuments()).toBe(2);
  });

  it('rejects refresh token reuse and invalidates the session family', async () => {
    await request(app).post('/api/v1/auth/register').send(validUser).expect(201);
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: validUser.email,
        password: validUser.password,
      })
      .expect(200);

    const firstCookie = getRefreshCookie(loginResponse);
    const rotateResponse = await request(app)
      .post('/api/v1/auth/refresh-token')
      .set('Cookie', firstCookie)
      .expect(200);

    await request(app).post('/api/v1/auth/refresh-token').set('Cookie', firstCookie).expect(401);
    await request(app)
      .post('/api/v1/auth/refresh-token')
      .set('Cookie', getRefreshCookie(rotateResponse))
      .expect(401);
  });

  it('logs out and revokes the current session', async () => {
    await request(app).post('/api/v1/auth/register').send(validUser).expect(201);
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: validUser.email,
        password: validUser.password,
      })
      .expect(200);

    const cookie = getRefreshCookie(loginResponse);
    await request(app).post('/api/v1/auth/logout').set('Cookie', cookie).expect(200);
    await request(app).post('/api/v1/auth/logout').set('Cookie', cookie).expect(200);
    await request(app).post('/api/v1/auth/refresh-token').set('Cookie', cookie).expect(401);
  });

  it('changes password and invalidates existing refresh sessions', async () => {
    await request(app).post('/api/v1/auth/register').send(validUser).expect(201);
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: validUser.email,
        password: validUser.password,
      })
      .expect(200);

    const cookie = getRefreshCookie(loginResponse);
    await request(app)
      .patch('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${loginResponse.body.data.accessToken}`)
      .set('Cookie', cookie)
      .send({
        currentPassword: validUser.password,
        newPassword: 'NewPassword123!',
      })
      .expect(200);

    await request(app).post('/api/v1/auth/refresh-token').set('Cookie', cookie).expect(401);
    await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: validUser.email,
        password: 'NewPassword123!',
      })
      .expect(200);
  });
});

describe('Role authorization middleware', () => {
  it('returns 403 when authenticated user has insufficient role', async () => {
    const testApp = express();
    testApp.get(
      '/admin',
      (req, res, next) => {
        req.user = { role: roles.BUYER };
        next();
      },
      authorize(roles.ADMIN),
      (req, res) => res.json({ success: true }),
    );
    testApp.use(errorHandler);

    const response = await request(testApp).get('/admin').expect(403);

    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Insufficient permissions');
  });
});
