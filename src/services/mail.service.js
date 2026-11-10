const crypto = require('node:crypto');
const nodemailer = require('nodemailer');
const env = require('../config/env');
const Delivery = require('../models/mailDelivery.model');
const Action = require('../models/emailAction.model');
const configured = () => Boolean(env.SMTP_HOST && env.SMTP_FROM && env.SMTP_USER && env.SMTP_PASSWORD);
const key = () => crypto.createHash('sha256').update(env.JWT_REFRESH_SECRET).digest();
const encrypt = value => {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
};
const decrypt = value => {
  const data = Buffer.from(value, 'base64');
  const cipher = crypto.createDecipheriv('aes-256-gcm', key(), data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8'));
};
const send = async message => {
  if (!configured()) throw new Error('SMTP_NOT_CONFIGURED');
  const transport = nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }, connectionTimeout: 10000, socketTimeout: 15000,
    requireTLS: !env.SMTP_SECURE });
  try { await transport.sendMail({ ...message, from: env.SMTP_FROM }); }
  finally { transport.close(); }
};
const processBatch = async ({ limit = 20, now = new Date() } = {}) => {
  const due = { $or: [{ status: 'PENDING', nextAttemptAt: { $lte: now } },
    { status: 'PROCESSING', lockedAt: { $lte: new Date(now - 5 * 60000) } }] };
  const candidates = await Delivery.find({ ...due, attempts: { $lt: 5 } }).sort({ createdAt: 1 }).limit(limit);
  let sent = 0;
  for (const candidate of candidates) {
    const item = await Delivery.findOneAndUpdate({ _id: candidate._id, ...due, attempts: { $lt: 5 } },
      { $set: { status: 'PROCESSING', lockedAt: now }, $inc: { attempts: 1 } }, { new: true }).select('+encrypted');
    if (!item) continue;
    let status; let lastError = null;
    try {
      const action = await Action.findById(item.actionId);
      const user = action && await require('../models/user.model').findById(action.userId).select('+resetVersion +verificationVersion');
      const currentVersion = action?.purpose === 'reset' ? user?.resetVersion : user?.verificationVersion;
      if (!action || !user || user.status !== 'ACTIVE' || currentVersion !== action.version || action.consumedAt || item.expiresAt <= now) status = 'EXPIRED';
      else { await module.exports.send(decrypt(item.encrypted)); status = 'SENT'; sent++; }
    } catch { status = item.attempts >= 5 ? 'FAILED' : 'PENDING'; lastError = configured() ? 'SMTP_DELIVERY_FAILED' : 'SMTP_NOT_CONFIGURED'; }
    await Delivery.updateOne({ _id: item._id, status: 'PROCESSING', lockedAt: now }, { $set: {
      status, lastError, nextAttemptAt: new Date(now.getTime() + item.attempts * 60000),
      ...(status === 'SENT' ? { sentAt: new Date() } : {}),
    }, $unset: { lockedAt: 1 } });
  }
  return { sent, scanned: candidates.length };
};
module.exports = { configured, encrypt, decrypt, send, processBatch };
