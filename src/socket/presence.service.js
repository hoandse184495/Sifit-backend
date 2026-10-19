const Conversation = require('../models/conversation.model');

const activeConnections = new Map();

const getRelatedUserIds = async (userId) => {
  const conversations = await Conversation.find({ participants: userId }).select('participants');
  const related = new Set();
  conversations.forEach((conversation) => {
    conversation.participants.forEach((participantId) => {
      if (String(participantId) !== String(userId)) related.add(String(participantId));
    });
  });
  return [...related];
};

const addConnection = async (userId, socketId, emitPresence) => {
  const key = String(userId);
  const existing = activeConnections.get(key) || new Set();
  const wasOffline = existing.size === 0;
  existing.add(socketId);
  activeConnections.set(key, existing);

  if (wasOffline) {
    const recipients = await getRelatedUserIds(userId);
    recipients.forEach((recipientId) => emitPresence(recipientId, { userId: key, online: true }));
  }
};

const removeConnection = async (userId, socketId, emitPresence) => {
  const key = String(userId);
  const existing = activeConnections.get(key);
  if (!existing) return;
  existing.delete(socketId);
  if (existing.size > 0) return;

  activeConnections.delete(key);
  const recipients = await getRelatedUserIds(userId);
  recipients.forEach((recipientId) => emitPresence(recipientId, { userId: key, online: false }));
};

const isOnline = (userId) => activeConnections.has(String(userId));

module.exports = { addConnection, isOnline, removeConnection };
