const env = require('../config/env');
const OutboxEvent = require('../models/outboxEvent.model');
const notificationService = require('./notification.service');

const enqueueNotificationEvent = async (event, options = {}) =>
  OutboxEvent.findOneAndUpdate(
    { eventKey: event.eventKey },
    {
      $setOnInsert: {
        eventKey: event.eventKey,
        type: event.type,
        payload: event.payload,
        status: 'PENDING',
        nextAttemptAt: new Date(),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true, session: options.session },
  );

const processEvent = async (event) => {
  if (event.type !== 'NOTIFICATION_CREATE') return;
  await notificationService.createNotification(event.payload);
};

const processBatch = async ({ limit = env.NOTIFICATION_OUTBOX_BATCH_SIZE } = {}) => {
  const events = await OutboxEvent.find({
    status: { $in: ['PENDING', 'FAILED'] },
    nextAttemptAt: { $lte: new Date() },
    attempts: { $lt: env.NOTIFICATION_OUTBOX_RETRY_LIMIT },
  })
    .sort({ createdAt: 1 })
    .limit(limit);

  let processed = 0;
  for (const event of events) {
    event.status = 'PROCESSING';
    event.lockedAt = new Date();
    event.attempts += 1;
    await event.save();

    try {
      await processEvent(event);
      event.status = 'PROCESSED';
      event.processedAt = new Date();
      event.lastError = undefined;
      processed += 1;
    } catch (error) {
      event.status = event.attempts >= env.NOTIFICATION_OUTBOX_RETRY_LIMIT ? 'FAILED' : 'PENDING';
      event.lastError = error.message;
      event.nextAttemptAt = new Date(Date.now() + Math.min(event.attempts, 5) * 60 * 1000);
    }

    await event.save();
  }

  return { processed, scanned: events.length };
};

module.exports = { enqueueNotificationEvent, processBatch, processEvent };
