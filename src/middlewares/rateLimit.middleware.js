const rateLimit = require('express-rate-limit');
const crypto = require('node:crypto');
const env = require('../config/env');
const { verifyAccessToken } = require('../utils/token');
const { ipKeyGenerator } = rateLimit;

const ipKey = (req) => `ip:${ipKeyGenerator(req.ip || req.socket?.remoteAddress || '127.0.0.1')}`;
const userOrIP = (req) => {
  if (req.user?._id) return `user:${req.user._id}`;
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) {
    try {
      const token = verifyAccessToken(header.slice(7).trim());
      // Never use an unverified/decoded JWT or user-supplied header as the key.
      if (token.type === 'access' && /^[a-f\d]{24}$/i.test(token.sub)) return `user:${token.sub}`;
    } catch {
      /* Invalid and expired tokens share the public IP budget. */
    }
  }
  return ipKey(req);
};
const makeLimiter = ({
  scope,
  limit,
  windowMs = 60000,
  keyGenerator = userOrIP,
  skipSuccessfulRequests = false,
}) =>
  rateLimit({
    windowMs,
    limit,
    keyGenerator,
    skipSuccessfulRequests,
    identifier: scope,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(
          ((req.rateLimit?.resetTime?.getTime() || Date.now() + windowMs) - Date.now()) / 1000,
        ),
      );
      const message = scope.startsWith('auth-signin')
        ? `Bạn đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${retryAfterSeconds} giây.`
        : `Bạn thao tác quá nhanh. Vui lòng thử lại sau ${retryAfterSeconds} giây.`;
      res.set('Retry-After', String(retryAfterSeconds)).status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        scope,
        retryAfterSeconds,
        message,
        errors: [],
      });
    },
  });

// The factory lets regression tests exercise real counters with short budgets,
// without disabling protection or sending hundreds of unnecessary requests.
const createRateLimiters = (options = {}) => {
  const readLimiter = makeLimiter({
    scope: 'api-read',
    limit: options.readLimit ?? env.RATE_LIMIT_READ_PER_MINUTE,
  });
  const writeLimiter = makeLimiter({
    scope: 'api-write',
    limit: options.writeLimit ?? env.RATE_LIMIT_WRITE_PER_MINUTE,
  });
  const loginLimiter = makeLimiter({
    scope: 'auth-signin-ip',
    limit: options.loginLimit ?? 60,
    windowMs: 15 * 60000,
    keyGenerator: ipKey,
    skipSuccessfulRequests: true,
  });
  const loginIdentityLimiter = makeLimiter({
    scope: 'auth-signin-identity',
    limit: options.identityLimit ?? 12,
    windowMs: 15 * 60000,
    skipSuccessfulRequests: true,
    keyGenerator: (req) =>
      `${ipKey(req)}:${crypto
        .createHash('sha256')
        .update(
          String(req.body?.email || '')
            .trim()
            .toLowerCase()
            .slice(0, 254),
        )
        .digest('hex')}`,
  });
  const googleLoginLimiter = makeLimiter({
    scope: 'auth-signin-google',
    limit: options.googleLimit ?? 30,
    windowMs: 15 * 60000,
    keyGenerator: ipKey,
    skipSuccessfulRequests: true,
  });
  const registerLimiter = makeLimiter({
    scope: 'auth-register',
    limit: options.registerLimit ?? 60,
    windowMs: 15 * 60000,
    keyGenerator: ipKey,
  });
  const authSessionLimiter = makeLimiter({
    scope: 'auth-session',
    limit: options.sessionLimit ?? 120,
    keyGenerator: ipKey,
  });
  const chatMessageLimiter = makeLimiter({
    scope: 'chat-write',
    limit: options.chatLimit ?? env.CHAT_MAX_MESSAGES_PER_MINUTE,
  });
  const paymentWebhookLimiter = makeLimiter({
    scope: 'payment-webhook',
    limit: options.webhookLimit ?? 300,
    keyGenerator: ipKey,
  });
  const independentAuth = new Set([
    '/auth/login',
    '/auth/register',
    '/auth/google',
    '/auth/refresh-token',
    '/auth/logout',
  ]);
  const apiLimiter = (req, res, next) => {
    const route = req.path.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS' || route === '/health' || independentAuth.has(route))
      return next();
    return (['GET', 'HEAD'].includes(req.method) ? readLimiter : writeLimiter)(req, res, next);
  };
  // Compatibility for disposable browser scripts that reset their loopback
  // budget between scenarios. This is never exposed as an HTTP endpoint.
  apiLimiter.resetKey = (key) => {
    const normalized =
      key.startsWith('user:') || key.startsWith('ip:') ? key : `ip:${ipKeyGenerator(key)}`;
    return Promise.all(
      [
        readLimiter,
        writeLimiter,
        loginLimiter,
        googleLoginLimiter,
        registerLimiter,
        authSessionLimiter,
        chatMessageLimiter,
        paymentWebhookLimiter,
      ].map((limiter) => limiter.resetKey(normalized)),
    );
  };
  return {
    apiLimiter,
    readLimiter,
    writeLimiter,
    loginLimiter,
    loginIdentityLimiter,
    googleLoginLimiter,
    registerLimiter,
    authSessionLimiter,
    chatMessageLimiter,
    paymentWebhookLimiter,
  };
};
module.exports = { ...createRateLimiters(), createRateLimiters };
