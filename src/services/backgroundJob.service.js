const crypto = require('node:crypto');
const { setInterval, clearInterval, setTimeout, clearTimeout } = require('node:timers');
const BackgroundJob = require('../models/backgroundJob.model');
const env = require('../config/env');
const logger = require('../utils/logger');

const LEASE_MS = 180000;

const runLeasedJob = async ({ name, intervalMs, run, leaseMs = LEASE_MS }) => {
  const owner = crypto.randomUUID();
  const now = new Date();
  let lease;
  try {
    lease = await BackgroundJob.findOneAndUpdate(
      {
        _id: name,
        $and: [
          { $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] },
          { $or: [{ nextRunAt: null }, { nextRunAt: { $lte: now } }] },
        ],
      },
      {
        $set: { owner, lockedUntil: new Date(now.getTime() + leaseMs), lastStartedAt: now },
        $inc: { runCount: 1 },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    // An existing, busy/not-yet-due job conflicts with upsert on the primary key.
    if (error.code === 11000) return { skipped: true };
    throw error;
  }
  if (!lease) return { skipped: true };

  let renewing = false;
  let renewal = Promise.resolve();
  const heartbeat = setInterval(() => {
    if (renewing) return;
    renewing = true;
    renewal = BackgroundJob.updateOne(
      { _id: name, owner },
      { $set: { lockedUntil: new Date(Date.now() + leaseMs) } },
    )
      .catch(() => logger.warn(`Background job ${name}: lease renewal failed`))
      .finally(() => {
        renewing = false;
      });
  }, leaseMs / 3);
  heartbeat.unref();

  let result;
  let failure;
  try {
    result = await run();
  } catch (error) {
    failure = error;
  } finally {
    clearInterval(heartbeat);
    await renewal;
    const finishedAt = new Date();
    await BackgroundJob.updateOne(
      { _id: name, owner },
      {
        $set: {
          lockedUntil: finishedAt,
          nextRunAt: new Date(finishedAt.getTime() + intervalMs),
          lastFinishedAt: finishedAt,
          // Store error class only: provider errors may contain credentials or private data.
          lastError: failure ? failure.name || 'Error' : null,
          ...(failure ? {} : { lastSucceededAt: finishedAt, lastResult: result }),
        },
        ...(failure ? { $inc: { failureCount: 1 } } : {}),
        $unset: { owner: 1 },
      },
    );
  }
  if (failure) throw failure;
  return { skipped: false, result };
};

// Schedule after completion, rather than overlapping long-running interval callbacks.
const createScheduler = (
  jobs,
  {
    execute = runLeasedJob,
    log = logger,
    scheduleTimeout = setTimeout,
    cancelTimeout = clearTimeout,
  } = {},
) => {
  let stopped = false;
  const states = jobs.map((job) => ({ job, timer: null, active: null }));
  const schedule = (state, delay) => {
    if (stopped) return;
    state.timer = scheduleTimeout(() => {
      state.active = Promise.resolve()
        .then(() => execute(state.job))
        .then((result) => {
          if (!result.skipped)
            log.info(`Background job ${state.job.name} completed`, result.result);
        })
        .catch((error) =>
          log.error(
            `Background job ${state.job.name} failed (${error.name || 'Error'}); will retry`,
          ),
        )
        .finally(() => {
          state.active = null;
          schedule(state, state.job.intervalMs);
        });
    }, delay);
    state.timer.unref();
  };
  states.forEach((state) => schedule(state, 0));
  return {
    async stop() {
      stopped = true;
      states.forEach((state) => cancelTimeout(state.timer));
      await Promise.all(states.map((state) => state.active));
    },
  };
};

const startBackgroundJobs = () => {
  if (!env.BACKGROUND_JOBS_ENABLED) {
    logger.info('Background jobs disabled');
    return { stop: async () => {} };
  }
  const payments = require('./payment.service');
  const reservations = require('./reservation.service');
  const notifications = require('./notificationEvent.service');
  const limit = env.BACKGROUND_JOB_BATCH_SIZE;
  logger.info('Background jobs enabled: marketplace maintenance and notification outbox');
  return createScheduler([
    {
      name: 'marketplace-maintenance',
      intervalMs: env.BACKGROUND_MAINTENANCE_INTERVAL_SECONDS * 1000,
      run: async () => ({
        payments: await payments.expirePendingPayments({ limit }),
        reservations: await reservations.expireReservations({ limit }),
        offers: await require('./offer.service').expireOffers({ limit }),
      }),
    },
    {
      name: 'notification-outbox',
      intervalMs: env.BACKGROUND_NOTIFICATION_INTERVAL_SECONDS * 1000,
      run: () => notifications.processBatch(),
    },
  ]);
};

module.exports = { runLeasedJob, createScheduler, startBackgroundJobs };
