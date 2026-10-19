const notificationService = require('../services/notification.service');

const registerNotificationHandlers = async (socket) => {
  const unreadCount = await notificationService.unreadCount(socket.user);
  socket.emit('notification:count', { unreadCount });
};

module.exports = registerNotificationHandlers;
