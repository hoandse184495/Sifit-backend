const Outbox = require('../models/outboxEvent.model');
module.exports = async (resourceIds) => {
  try {
    const ids = resourceIds.flatMap((id) => [id, String(id)]);
    const events = await Outbox.find({
      'payload.resourceId': { $in: ids },
      status: { $in: ['PENDING', 'FAILED'] },
      nextAttemptAt: { $lte: new Date() },
    })
      .select('eventKey')
      .limit(50);
    if (events.length)
      await require('../services/notificationEvent.service').processBatch({
        limit: events.length,
        eventKeys: events.map((event) => event.eventKey),
      });
  } catch (_error) {
    /* Committed outbox events remain retryable by the worker. */
  }
};
