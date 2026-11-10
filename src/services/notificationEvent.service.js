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
  if (event.type === 'SHOP_PRODUCT_APPROVED')
    return require('./shopFollow.service').fanOutApproval(event.payload);
  if (event.type !== 'NOTIFICATION_CREATE') return;
  await notificationService.createNotification(event.payload);
};

const processBatch = async ({ limit = env.NOTIFICATION_OUTBOX_BATCH_SIZE, eventKeys } = {}) => {
  const now = new Date();
  const due = {
    $or: [
      { status: { $in: ['PENDING', 'FAILED'] }, nextAttemptAt: { $lte: now } },
      { status: 'PROCESSING', lockedAt: { $lte: new Date(now.getTime() - 5 * 60000) } },
    ],
  };
  const events = await OutboxEvent.find({
    ...due,
    attempts: { $lt: env.NOTIFICATION_OUTBOX_RETRY_LIMIT },
    ...(eventKeys ? { eventKey: { $in: eventKeys } } : {}),
  })
    .sort({ createdAt: 1 })
    .limit(limit);

  let processed = 0;
  for (const candidate of events) {
    const lockedAt = new Date();
    const event = await OutboxEvent.findOneAndUpdate(
      { _id: candidate._id, ...due, attempts: { $lt: env.NOTIFICATION_OUTBOX_RETRY_LIMIT } },
      { $set: { status: 'PROCESSING', lockedAt }, $inc: { attempts: 1 } },
      { new: true },
    );
    if (!event) continue;

    try {
      await processEvent(event);
      event.status = 'PROCESSED';
      event.processedAt = new Date();
      event.lastError = undefined;
      processed += 1;
    } catch (error) {
      event.status = event.attempts >= env.NOTIFICATION_OUTBOX_RETRY_LIMIT ? 'FAILED' : 'PENDING';
      event.lastError = error.name || 'NotificationError';
      event.nextAttemptAt = new Date(Date.now() + Math.min(event.attempts, 5) * 60 * 1000);
    }

    await OutboxEvent.updateOne(
      { _id: event._id, status: 'PROCESSING', lockedAt },
      {
        $set: {
          status: event.status,
          processedAt: event.processedAt,
          lastError: event.lastError || null,
          nextAttemptAt: event.nextAttemptAt,
        },
        $unset: { lockedAt: 1 },
      },
    );
  }

  return { processed, scanned: events.length };
};

module.exports = { enqueueNotificationEvent, processBatch, processEvent };
