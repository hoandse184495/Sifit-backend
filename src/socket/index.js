const { Server } = require('socket.io');
const env = require('../config/env');
const logger = require('../utils/logger');
const registerChatHandlers = require('./chat.handlers');
const registerNotificationHandlers = require('./notification.handlers');
const socketAuth = require('./socketAuth.middleware');
const presence = require('./presence.service');
const { refreshSocketUser, installAccountAccess } = require('./accountAccess');

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
    installAccountAccess(socket);
    // Install handlers before waiting on database presence so initial client
    // events are not dropped during the connection handshake.
    registerChatHandlers(io, socket);
    let presenceReady = Promise.resolve();
    socket.on('disconnect', () => {
      presenceReady
        .then(() =>
          presence.removeConnection(socket.user._id, socket.id, (recipientId, payload) =>
            emitToUser(recipientId, 'presence:update', payload),
          ),
        )
        .catch(() => logger.warn('Socket presence cleanup failed'));
    });
    try {
      // Close the gap between handshake authentication and joining the user
      // room: a suspension may have committed between those operations.
      await refreshSocketUser(socket);
      if (!socket.connected) return;
      presenceReady = presence.addConnection(socket.user._id, socket.id, (recipientId, payload) =>
        emitToUser(recipientId, 'presence:update', payload),
      );
      await presenceReady;
      if (socket.connected) await registerNotificationHandlers(socket);
    } catch {
      socket.emit('account:suspended', {
        message: 'Phiên kết nối không còn khả dụng. Vui lòng đăng nhập lại.',
      });
      socket.disconnect(true);
    }
  });

  return io;
};

const getIo = () => io;
const disconnectUser = (userId, message) => {
  if (!io) return;
  io.in(userRoom(userId)).emit('account:suspended', {
    message: message || 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên.',
  });
  io.in(userRoom(userId)).disconnectSockets(true);
};

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
  disconnectUser,
  initSocket,
  userRoom,
};
