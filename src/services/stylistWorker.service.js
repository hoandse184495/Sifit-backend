const { setInterval, clearInterval } = require('node:timers');
const Job = require('../models/stylistJob.model');
const service = require('./stylist.service');
const env = require('../config/env');

// Persist completed results even when the member leaves the page.
// Each paid submission is protected by the durable phase transition in advance().
function startStylistWorker() {
  let pending = null;
  let stopped = false;
  const tick = () => {
    if (stopped || pending || !env.FASHN_API_KEY) return;
    pending = (async () => {
      const jobs = await Job.find({ active: true, phase: { $in: ['queued', 'submitting', 'processing'] }, expiresAt: { $gt: new Date() } }).sort({ updatedAt: 1 }).limit(10);
      for (const job of jobs) {
        if (stopped) break;
        try { await service.get(job.userId, job.id); } catch { /* A transient poll failure never triggers a second paid submission. */ }
      }
    })().catch(() => {}).finally(() => { pending = null; });
  };
  const timer = setInterval(tick, 5000);
  timer.unref();
  tick();
  return { async stop() { stopped = true; clearInterval(timer); await pending; } };
}
module.exports = { startStylistWorker };
