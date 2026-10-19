const http = require('http');
const mongoose = require('mongoose');
const request = require('supertest');
const { io: createClient } = require('socket.io-client');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const roles = require('../src/constants/roles');
const { closeSocket, initSocket } = require('../src/socket');
const Category = require('../src/models/category.model');
const Conversation = require('../src/models/conversation.model');
const ConversationReadState = require('../src/models/conversationReadState.model');
const Message = require('../src/models/message.model');
const MessageReport = require('../src/models/messageReport.model');
const Notification = require('../src/models/notification.model');
const NotificationPreference = require('../src/models/notificationPreference.model');
const OutboxEvent = require('../src/models/outboxEvent.model');
const Product = require('../src/models/product.model');
const User = require('../src/models/user.model');
const UserBlock = require('../src/models/userBlock.model');
const notificationEventService = require('../src/services/notificationEvent.service');

let mongoServer;
let server;
let baseUrl;
let category;

const registerAndLogin = async (email, role = roles.BUYER) => {
  const password = 'StrongPassword123!';
  await request(app)
    .post('/api/v1/auth/register')
    .send({ fullName: email.split('@')[0], email, password })
    .expect(201);

  if (role !== roles.BUYER) {
    await User.updateOne({ email }, { role });
  }

  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  const user = await User.findOne({ email });
  return { accessToken: response.body.data.accessToken, user };
};

const createProduct = (sellerId, overrides = {}) =>
  Product.create({
    sellerId,
    title: overrides.title || 'Vintage denim jacket',
    description: 'A clean second-hand item.',
    price: 200000,
    categoryId: category._id,
    brand: 'Levis',
    size: 'M',
    color: 'Blue',
    condition: 'GOOD',
    status: 'ACTIVE',
    images: [{ url: 'https://example.com/image.png', publicId: 'sifit/products/image' }],
    ...overrides,
  });

const listen = (httpServer) =>
  new Promise((resolve) => {
    httpServer.listen(0, () => resolve(httpServer.address().port));
  });

const connectSocket = (token) =>
  new Promise((resolve, reject) => {
    const client = createClient(baseUrl, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    client.on('connect', () => resolve(client));
    client.on('connect_error', reject);
  });

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([
    User.init(),
    Category.init(),
    Product.init(),
    Conversation.init(),
    Message.init(),
    ConversationReadState.init(),
    Notification.init(),
    NotificationPreference.init(),
    OutboxEvent.init(),
    UserBlock.init(),
    MessageReport.init(),
  ]);

  server = http.createServer(app);
  initSocket(server);
  const port = await listen(server);
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await closeSocket();
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Category.deleteMany({}),
    Product.deleteMany({}),
    Conversation.deleteMany({}),
    Message.deleteMany({}),
    ConversationReadState.deleteMany({}),
    Notification.deleteMany({}),
    NotificationPreference.deleteMany({}),
    OutboxEvent.deleteMany({}),
    UserBlock.deleteMany({}),
    MessageReport.deleteMany({}),
  ]);
  category = await Category.create({ name: 'Ao khoac', slug: 'ao-khoac' });
});

describe('Phase 8 REST conversations and messages', () => {
  it('creates one conversation per buyer seller product and rejects unauthorized access', async () => {
    const buyer = await registerAndLogin('buyer@example.com');
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const other = await registerAndLogin('other@example.com');
    const product = await createProduct(seller.user._id);

    const created = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ productId: product.id })
      .expect(201);

    const duplicated = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ productId: product.id })
      .expect(201);

    expect(duplicated.body.data.conversation.id).toBe(created.body.data.conversation.id);
    expect(await Conversation.countDocuments()).toBe(1);

    await request(app)
      .get(`/api/v1/conversations/${created.body.data.conversation.id}`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(404);

    await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ productId: product.id })
      .expect(403);
  });

  it('sends messages idempotently, paginates history, and updates read receipts', async () => {
    const buyer = await registerAndLogin('buyer@example.com');
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const product = await createProduct(seller.user._id);
    const conversationResponse = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ productId: product.id })
      .expect(201);
    const conversationId = conversationResponse.body.data.conversation.id;
    const clientMessageId = '11111111-1111-4111-8111-111111111111';

    const sent = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ clientMessageId, type: 'TEXT', content: 'Is this still available?' })
      .expect(201);

    const duplicate = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ clientMessageId, type: 'TEXT', content: 'Is this still available?' })
      .expect(201);

    expect(duplicate.body.data.message.id).toBe(sent.body.data.message.id);
    expect(duplicate.body.data.duplicate).toBe(true);
    expect(await Message.countDocuments()).toBe(1);

    const messages = await request(app)
      .get(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);
    expect(messages.body.data.items).toHaveLength(1);

    await request(app)
      .patch(`/api/v1/conversations/${conversationId}/read`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ lastReadMessageId: sent.body.data.message.id })
      .expect(200);

    const list = await request(app)
      .get('/api/v1/conversations')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);
    expect(list.body.data.items[0].unreadCount).toBe(0);
  });

  it('blocks users, prevents new messages, and supports message reports', async () => {
    const buyer = await registerAndLogin('buyer@example.com');
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const admin = await registerAndLogin('admin@example.com', roles.ADMIN);
    const product = await createProduct(seller.user._id);
    const conversation = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ productId: product.id })
      .expect(201);
    const conversationId = conversation.body.data.conversation.id;

    const message = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        clientMessageId: '22222222-2222-4222-8222-222222222222',
        type: 'TEXT',
        content: 'Hello',
      })
      .expect(201);

    await request(app)
      .post(`/api/v1/messages/${message.body.data.message.id}/report`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ reason: 'Spam' })
      .expect(201);

    await request(app)
      .get('/api/v1/admin/message-reports')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    await request(app)
      .post(`/api/v1/users/${buyer.user.id}/block`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);

    await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        clientMessageId: '33333333-3333-4333-8333-333333333333',
        type: 'TEXT',
        content: 'Can you see this?',
      })
      .expect(403);
  });
});

describe('Phase 8 notifications', () => {
  it('creates private message notifications and enforces preferences and ownership', async () => {
    const buyer = await registerAndLogin('buyer@example.com');
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const product = await createProduct(seller.user._id);
    const conversation = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ productId: product.id })
      .expect(201);

    await request(app)
      .post(`/api/v1/conversations/${conversation.body.data.conversation.id}/messages`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        clientMessageId: '44444444-4444-4444-8444-444444444444',
        type: 'TEXT',
        content: 'Ping',
      })
      .expect(201);

    const sellerNotifications = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);
    expect(sellerNotifications.body.data.items).toHaveLength(1);

    await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200)
      .expect((response) => expect(response.body.data.items).toHaveLength(0));

    await request(app)
      .patch('/api/v1/notifications/preferences')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ messageNotifications: false })
      .expect(200);

    await request(app)
      .post(`/api/v1/conversations/${conversation.body.data.conversation.id}/messages`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        clientMessageId: '55555555-5555-4555-8555-555555555555',
        type: 'TEXT',
        content: 'Muted ping',
      })
      .expect(201);

    expect(await Notification.countDocuments({ recipientId: seller.user._id })).toBe(1);
  });

  it('queues product moderation notifications through the outbox idempotently', async () => {
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const admin = await registerAndLogin('admin@example.com', roles.ADMIN);
    const product = await createProduct(seller.user._id, { status: 'DRAFT' });

    await request(app)
      .post(`/api/v1/products/${product.id}/submit`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);

    expect(await OutboxEvent.countDocuments()).toBe(1);
    expect(await Notification.countDocuments({ recipientId: admin.user._id })).toBe(0);

    await notificationEventService.processBatch();
    await notificationEventService.processBatch();

    expect(await Notification.countDocuments({ recipientId: admin.user._id })).toBe(1);
  });
});

describe('Phase 8 Socket.IO', () => {
  it('authenticates sockets, rejects unauthorized joins, and delivers persisted messages', async () => {
    const buyer = await registerAndLogin('buyer@example.com');
    const seller = await registerAndLogin('seller@example.com', roles.SELLER);
    const other = await registerAndLogin('other@example.com');
    const product = await createProduct(seller.user._id);
    const conversation = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ productId: product.id })
      .expect(201);
    const conversationId = conversation.body.data.conversation.id;

    await expect(connectSocket('bad-token')).rejects.toBeTruthy();

    const buyerSocket = await connectSocket(buyer.accessToken);
    const sellerSocket = await connectSocket(seller.accessToken);
    const otherSocket = await connectSocket(other.accessToken);

    const unauthorizedJoin = await new Promise((resolve) => {
      otherSocket.emit('conversation:join', { conversationId }, resolve);
    });
    expect(unauthorizedJoin.ok).toBe(false);

    await new Promise((resolve) =>
      buyerSocket.emit('conversation:join', { conversationId }, resolve),
    );
    await new Promise((resolve) =>
      sellerSocket.emit('conversation:join', { conversationId }, resolve),
    );

    const received = new Promise((resolve) => sellerSocket.once('message:new', resolve));
    const ack = await new Promise((resolve) => {
      buyerSocket.emit(
        'message:send',
        {
          conversationId,
          clientMessageId: '66666666-6666-4666-8666-666666666666',
          type: 'TEXT',
          content: 'Socket hello',
        },
        resolve,
      );
    });

    expect(ack.ok).toBe(true);
    const payload = await received;
    expect(payload.message.content).toBe('Socket hello');
    expect(await Message.countDocuments({ conversationId })).toBe(1);

    buyerSocket.disconnect();
    sellerSocket.disconnect();
    otherSocket.disconnect();
  });
});
