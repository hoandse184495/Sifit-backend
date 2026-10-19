const { Server } = require('socket.io');
const env = require('../config/env');
const logger = require('../utils/logger');
const registerChatHandlers = require('./chat.handlers');
const registerNotificationHandlers = require('./notification.handlers');
const socketAuth = require('./socketAuth.middleware');
const presence = require('./presence.service');

let io;

const userRoom = (userId) => `user:${String(userId)}`;
const conversationRoom = (conversationId) => `conversation:${String(conversationId)}`;

const initSocket = (server) => {
  if (!env.SOCKET_IO_ENABLED) {
    logger.info('Socket.IO disabled');
    return null;
  }
  if (io) return io;

  io = new Server(server, {
    cors: {
      origin: env.SOCKET_CORS_ORIGIN,
      credentials: true,
    },
  });

  io.use(socketAuth);

  io.on('connection', async (socket) => {
    socket.join(userRoom(socket.user._id));
    socket.data.joinedConversations = new Set();

    await presence.addConnection(socket.user._id, socket.id, (recipientId, payload) => {
      emitToUser(recipientId, 'presence:update', payload);
    });

    registerChatHandlers(io, socket);
    registerNotificationHandlers(socket);

    socket.on('disconnect', async () => {
      await presence.removeConnection(socket.user._id, socket.id, (recipientId, payload) => {
        emitToUser(recipientId, 'presence:update', payload);
      });
    });
  });

  return io;
};

const getIo = () => io;

const closeSocket = async () => {
  if (!io) return;
  await new Promise((resolve) => io.close(resolve));
  io = null;
};

const emitToUser = (userId, event, payload) => {
  if (!io) return;
  io.to(userRoom(userId)).emit(event, payload);
};

const emitToConversation = (conversationId, event, payload) => {
  if (!io) return;
  io.to(conversationRoom(conversationId)).emit(event, payload);
};

module.exports = {
  conversationRoom,
  closeSocket,
  emitToConversation,
  emitToUser,
  getIo,
  initSocket,
  userRoom,
};
