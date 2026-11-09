jest.mock('../src/config/cloudinary', () => ({ uploadBuffer: jest.fn(), deleteAsset: jest.fn() }));
const mongoose = require('mongoose');
const argon2 = require('argon2');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const User = require('../src/models/user.model');
const cloudinary = require('../src/config/cloudinary');
const { signAccessToken } = require('../src/utils/token');
const logger = require('../src/utils/logger');
const env = require('../src/config/env');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/XioAAAAASUVORK5CYII=', 'base64');
let mongo, passwordHash, users;
const token = user => `Bearer ${signAccessToken(user)}`;
const avatarRequest = user => request(app).post('/api/v1/auth/me/avatar').set('Authorization', token(user));
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await User.init();
  passwordHash = await argon2.hash('ProfilePassword123!');
});
beforeEach(async () => {
  await User.deleteMany({});
  cloudinary.uploadBuffer.mockReset().mockResolvedValue({ secure_url: 'https://res.cloudinary.com/sifit/avatar-new.png', public_id: 'sifit/avatars/new' });
  cloudinary.deleteAsset.mockReset().mockResolvedValue({ result: 'ok' });
  users = await User.create([
    { fullName: 'Buyer Profile', email: 'buyer@profile.test', passwordHash, role: 'BUYER' },
    { fullName: 'Seller Profile', email: 'seller@profile.test', passwordHash, role: 'SELLER' },
    { fullName: 'Admin Profile', email: 'admin@profile.test', passwordHash, role: 'ADMIN' },
    { fullName: 'Google Profile', email: 'google@profile.test', googleId: 'profile-google-id', authProvider: 'google', emailVerified: true, avatar: 'https://lh3.googleusercontent.com/google-photo', role: 'BUYER' },
  ]);
});
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

describe('Personal profile', () => {
  it('persists trimmed name/phone for all roles and Google-only accounts without changing account credentials', async () => {
    for (const user of users) {
      const result = await request(app).patch('/api/v1/auth/me').set('Authorization', token(user))
        .send({ fullName: '  Nguyễn Minh Anh  ', phone: '  +84 901 234 567  ' }).expect(200);
      expect(result.body.data.user).toMatchObject({ id: user.id, fullName: 'Nguyễn Minh Anh', phone: '+84 901 234 567', role: user.role, email: user.email });
      expect(result.body.data.user.hasPassword).toBe(user.authProvider !== 'google');
      const persisted = await User.findById(user._id).select('+passwordHash +googleId');
      expect(persisted.passwordHash).toBe(user.passwordHash);
      expect(persisted.googleId).toBe(user.googleId);
      const me = await request(app).get('/api/v1/auth/me').set('Authorization', token(user)).expect(200);
      expect(me.body.data.user.fullName).toBe('Nguyễn Minh Anh');
    }
    await request(app).post('/api/v1/auth/login').send({ email: users[0].email, password: 'ProfilePassword123!' }).expect(200);
  });
  it('allows removing an optional phone and preserves fields omitted from the request', async () => {
    await User.updateOne({ _id: users[0]._id }, { phone: '0901234567' });
    await request(app).patch('/api/v1/auth/me').set('Authorization', token(users[0])).send({ phone: '' }).expect(200);
    const persisted = await User.findById(users[0]._id);
    expect(persisted.phone).toBe('');
    expect(persisted.fullName).toBe(users[0].fullName);
  });
  it('rejects missing auth, suspended users and invalid or privileged fields', async () => {
    await request(app).patch('/api/v1/auth/me').send({ fullName: 'Other' }).expect(401);
    for (const invalid of [{}, { fullName: '   ' }, { fullName: 'x'.repeat(101) }, { phone: 'abc123' },
      { fullName: 'Valid', role: 'ADMIN' }, { email: 'new@profile.test' }, { userId: users[1].id },
      { avatar: 'https://example.com/avatar' }, { passwordHash: 'forged' }, { googleId: 'forged' }, { avatarPublicId: 'other-asset' }]) {
      await request(app).patch('/api/v1/auth/me').set('Authorization', token(users[0])).send(invalid).expect(400);
    }
    await User.updateOne({ _id: users[0]._id }, { status: 'SUSPENDED' });
    await request(app).patch('/api/v1/auth/me').set('Authorization', token(users[0])).send({ fullName: 'New Name' }).expect(403);
    expect((await User.findById(users[1]._id)).fullName).toBe('Seller Profile');
  });
  it('keeps the trusted-origin guard for browser mutations', () => {
    const previous = env.NODE_ENV;
    env.NODE_ENV = 'development';
    try {
      const next = jest.fn();
      require('../src/middlewares/origin.middleware')({ get: () => 'https://untrusted.example' }, {}, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    } finally { env.NODE_ENV = previous; }
  });
});

describe('Personal avatar', () => {
  it('uploads to the authenticated user folder, replaces owned assets and keeps private fields out of responses', async () => {
    await User.updateOne({ _id: users[0]._id }, { avatar: 'https://example.com/old.png', avatarPublicId: 'sifit/avatars/old' });
    const result = await avatarRequest(users[0]).attach('avatar', png, { filename: 'avatar.png', contentType: 'image/png' }).expect(200);
    expect(result.body.data.user.avatar).toBe('https://res.cloudinary.com/sifit/avatar-new.png');
    expect(cloudinary.uploadBuffer.mock.calls[0][1]).toMatchObject({ folder: `sifit/avatars/${users[0].id}` });
    expect(cloudinary.deleteAsset).toHaveBeenCalledWith('sifit/avatars/old');
    expect(result.body.data.user.avatarPublicId).toBeUndefined();
    expect(result.body.data.user.passwordHash).toBeUndefined();
    expect(result.body.data.user.googleId).toBeUndefined();
    const persisted = await User.findById(users[0]._id).select('+avatarPublicId');
    expect(persisted.avatarPublicId).toBe('sifit/avatars/new');
  });
  it('replaces a Google photo without deleting an unmanaged external image and keeps Google sign-in linked', async () => {
    const result = await avatarRequest(users[3]).attach('avatar', png, 'google.png').expect(200);
    expect(result.body.data.user).toMatchObject({ hasPassword: false, googleLinked: true });
    expect(cloudinary.deleteAsset).not.toHaveBeenCalled();
    expect((await User.findById(users[3]._id).select('+googleId')).googleId).toBe('profile-google-id');
  });
  it('rejects missing, fake, oversized and multiple images without uploading assets', async () => {
    await request(app).post('/api/v1/auth/me/avatar').attach('avatar', png, 'avatar.png').expect(401);
    await avatarRequest(users[0]).expect(400);
    await avatarRequest(users[0]).attach('avatar', Buffer.from('<script>bad</script>'), { filename: 'avatar.png', contentType: 'image/png' }).expect(415);
    await avatarRequest(users[0]).attach('avatar', Buffer.alloc(5 * 1024 * 1024 + 1), 'big.png').expect(413);
    await avatarRequest(users[0]).attach('avatar', png, 'one.png').attach('avatar', png, 'two.png').expect(400);
    await avatarRequest(users[0]).attach('image', png, 'wrong.png').expect(400);
    expect(cloudinary.uploadBuffer).not.toHaveBeenCalled();
  });
  it('preserves the saved avatar on external upload failure and cleans up a new asset if persistence fails', async () => {
    await User.updateOne({ _id: users[0]._id }, { avatar: 'https://example.com/old.png', avatarPublicId: 'sifit/avatars/old' });
    cloudinary.uploadBuffer.mockRejectedValueOnce(new Error('Storage unavailable'));
    await avatarRequest(users[0]).attach('avatar', png, 'avatar.png').expect(500);
    expect((await User.findById(users[0]._id)).avatar).toBe('https://example.com/old.png');
    const update = jest.spyOn(User, 'findOneAndUpdate').mockRejectedValueOnce(new Error('Write unavailable'));
    try { await avatarRequest(users[0]).attach('avatar', png, 'avatar.png').expect(500); }
    finally { update.mockRestore(); }
    expect(cloudinary.deleteAsset).toHaveBeenCalledWith('sifit/avatars/new');
    expect((await User.findById(users[0]._id)).avatar).toBe('https://example.com/old.png');
  });
  it('deletes only the owned reference, is repeatable and handles cleanup failure without losing the successful profile change', async () => {
    await User.updateOne({ _id: users[0]._id }, { avatar: 'https://example.com/old.png', avatarPublicId: 'sifit/avatars/old' });
    cloudinary.deleteAsset.mockRejectedValueOnce(new Error('Delete unavailable'));
    const warning = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const result = await request(app).delete('/api/v1/auth/me/avatar').set('Authorization', token(users[0])).expect(200);
      expect(result.body.data.user.avatar).toBeUndefined();
      expect(warning).toHaveBeenCalled();
    } finally { warning.mockRestore(); }
    await request(app).delete('/api/v1/auth/me/avatar').set('Authorization', token(users[0])).expect(200);
    expect(cloudinary.deleteAsset).toHaveBeenCalledTimes(1);
    expect((await User.findById(users[1]._id)).avatar).toBeUndefined();
  });
});
