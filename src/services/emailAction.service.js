const crypto = require('node:crypto');
const { URL } = require('node:url');
const argon2 = require('argon2');
const env = require('../config/env');
const User = require('../models/user.model');
const Action = require('../models/emailAction.model');
const Delivery = require('../models/mailDelivery.model');
const AuthSession = require('../models/authSession.model');
const ApiError = require('../utils/ApiError');
const transaction = require('../utils/withTransaction');
const mail = require('./mail.service');
const hash = token => crypto.createHash('sha256').update(token).digest('hex');
const issue = async (email, purpose, { session: existingSession } = {}) => {
  // Unknown, suspended and Google-only reset requests have the same public result.
  const enqueue = async session => {
    const user = await User.findOne({ email: email.toLowerCase(), status: 'ACTIVE' }).select('+passwordHash').session(session);
    if (!user || (purpose === 'reset' && !user.passwordHash) || (purpose === 'verify' && user.emailVerified)) return;
    const field = purpose === 'reset' ? 'resetVersion' : 'verificationVersion';
    const locked = await User.findOneAndUpdate({ _id: user._id, status: 'ACTIVE' }, { $inc: { [field]: 1 } }, { new: true, session }).select(`+${field}`);
    if (!locked) return;
    if (await Action.exists({ userId: user._id, purpose, createdAt: { $gte: new Date(Date.now() - 60000) }, consumedAt: null }).session(session)) {
      // Undo the version bump so an existing, already-sent link remains valid.
      await User.updateOne({ _id: user._id }, { $inc: { [field]: -1 } }, { session }); return;
    }
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + (purpose === 'reset' ? 30 : 1440) * 60000);
    const [action] = await Action.create([{ userId: user._id, purpose, tokenHash: hash(token), version: locked[field], expiresAt }], { session });
    const link = new URL(env.FRONTEND_URL); link.searchParams.set('view', 'account-action'); link.searchParams.set('action', purpose); link.hash = `token=${token}`;
    const subject = purpose === 'reset' ? 'Đặt lại mật khẩu Sifit' : 'Xác minh email Sifit';
    await Delivery.create([{ actionId: action._id, expiresAt, purgeAt: new Date(Date.now() + 7 * 86400000),
      encrypted: mail.encrypt({ to: user.email, subject, text: `${subject}\n\nMở liên kết sau để tiếp tục:\n${link.href}\n\nLiên kết dùng một lần và hết hạn ${expiresAt.toISOString()}. Nếu không yêu cầu, hãy bỏ qua email này.`, messageId: `<${action.id}@sifit.id.vn>` }) }], { session });
  };
  if (existingSession) await enqueue(existingSession);
  else await transaction(enqueue);
};
const consume = async (purpose, token, newPassword) => {
  const passwordHash = purpose === 'reset' ? await argon2.hash(newPassword, { type: argon2.argon2id }) : null;
  const userId = await transaction(async session => {
    const action = await Action.findOneAndUpdate({ tokenHash: hash(token), purpose, consumedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { consumedAt: new Date() } }, { new: true, session });
    if (!action) throw new ApiError(400, 'Liên kết không hợp lệ, đã dùng hoặc đã hết hạn.');
    const field = purpose === 'reset' ? 'resetVersion' : 'verificationVersion';
    const user = await User.findOneAndUpdate({ _id: action.userId, status: 'ACTIVE', [field]: action.version },
      purpose === 'reset' ? { $set: { passwordHash }, $inc: { tokenVersion: 1, resetVersion: 1 } } : { $set: { emailVerified: true }, $inc: { verificationVersion: 1 } }, { new: true, session });
    if (!user) throw new ApiError(400, 'Liên kết đã bị thay thế hoặc tài khoản không khả dụng.');
    if (purpose === 'reset') await AuthSession.updateMany({ user: user._id, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'password_reset' } }, { session });
    return user._id;
  });
  if (purpose === 'reset') require('../socket').disconnectUser(userId, 'Mật khẩu đã thay đổi. Vui lòng đăng nhập lại.');
};
module.exports = { issue, consume };
