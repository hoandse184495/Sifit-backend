const { z } = require('zod');
const env = require('../config/env');
const httpStatus = require('../constants/httpStatus');
const ApiError = require('../utils/ApiError');
const conversationService = require('../services/conversation.service');
const messageService = require('../services/message.service');
const readReceiptService = require('../services/readReceipt.service');
const { sendMessageBodySchema } = require('../validations/message.validation');

const conversationRoom = (conversationId) => `conversation:${String(conversationId)}`;

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/);
const idPayload = z.object({ conversationId: objectId });
const readPayload = z.object({ conversationId: objectId, lastReadMessageId: objectId });

const rateBuckets = new Map();

const checkRate = (socket, key, limit, windowMs = 60 * 1000) => {
  const bucketKey = `${socket.id}:${key}`;
  const now = Date.now();
  const bucket = rateBuckets.get(bucketKey) || { count: 0, resetAt: now + windowMs };
  if (bucket.resetAt < now) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }
  bucket.count += 1;
  rateBuckets.set(bucketKey, bucket);
  if (bucket.count > limit) {
    throw new ApiError(httpStatus.TOO_MANY_REQUESTS, 'Too many socket events');
  }
};

const emitError = (socket, event, error, clientMessageId) => {
  socket.emit('message:error', {
    event,
    clientMessageId,
    message: error.message || 'Socket event failed',
  });
};

const registerChatHandlers = (io, socket) => {
  socket.on('conversation:join', async (payload, ack) => {
    try {
      checkRate(socket, 'join', 60);
      const parsed = idPayload.parse(payload);
      await conversationService.getParticipantIds(parsed.conversationId, socket.user);
      socket.join(conversationRoom(parsed.conversationId));
      socket.data.joinedConversations.add(parsed.conversationId);
      ack?.({ ok: true, conversationId: parsed.conversationId });
    } catch (error) {
      emitError(socket, 'conversation:join', error);
      ack?.({ ok: false, message: error.message });
    }
  });

  socket.on('conversation:leave', (payload, ack) => {
    try {
      const parsed = idPayload.parse(payload);
      socket.leave(conversationRoom(parsed.conversationId));
      socket.data.joinedConversations.delete(parsed.conversationId);
      ack?.({ ok: true, conversationId: parsed.conversationId });
    } catch (error) {
      emitError(socket, 'conversation:leave', error);
      ack?.({ ok: false, message: error.message });
    }
  });

  socket.on('message:send', async (payload, ack) => {
    try {
      checkRate(socket, 'message', env.CHAT_MAX_MESSAGES_PER_MINUTE);
      const parsed = z
        .object({ conversationId: objectId })
        .merge(sendMessageBodySchema)
        .parse(payload);
      const result = await messageService.sendMessage(parsed.conversationId, socket.user, parsed);
      socket.emit('message:ack', result);
      ack?.({ ok: true, ...result });
    } catch (error) {
      emitError(socket, 'message:send', error, payload?.clientMessageId);
      ack?.({ ok: false, message: error.message, clientMessageId: payload?.clientMessageId });
    }
  });

  socket.on('message:read', async (payload, ack) => {
    try {
      checkRate(socket, 'read', 120);
      const parsed = readPayload.parse(payload);
      const readState = await readReceiptService.markRead(
        parsed.conversationId,
        socket.user,
        parsed.lastReadMessageId,
      );
      ack?.({ ok: true, readState });
    } catch (error) {
      emitError(socket, 'message:read', error);
      ack?.({ ok: false, message: error.message });
    }
  });

  ['typing:start', 'typing:stop'].forEach((eventName) => {
    socket.on(eventName, async (payload, ack) => {
      try {
        checkRate(socket, 'typing', 30);
        const parsed = idPayload.parse(payload);
        await conversationService.getParticipantIds(parsed.conversationId, socket.user);
        socket.to(conversationRoom(parsed.conversationId)).emit('typing:update', {
          conversationId: parsed.conversationId,
          userId: String(socket.user._id),
          typing: eventName === 'typing:start',
        });
        ack?.({ ok: true });
      } catch (error) {
        emitError(socket, eventName, error);
        ack?.({ ok: false, message: error.message });
      }
    });
  });
};

module.exports = registerChatHandlers;
