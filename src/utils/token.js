const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

const JWT_ALGORITHM = 'HS256';

const hashTokenId = (tokenId) => crypto.createHash('sha256').update(tokenId).digest('hex');

const createTokenId = () => crypto.randomBytes(32).toString('hex');

const parseDurationToMs = (value) => {
  const match = /^(\d+)([smhd])$/.exec(value);

  if (!match) {
    throw new Error(`Unsupported token duration: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return amount * multipliers[unit];
};

const signAccessToken = (user) =>
  jwt.sign(
    {
      sub: user.id,
      role: user.role,
      type: 'access',
    },
    env.JWT_ACCESS_SECRET,
    {
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
      algorithm: JWT_ALGORITHM,
    },
  );

const signRefreshToken = ({ userId, tokenId, familyId }) =>
  jwt.sign(
    {
      sub: userId,
      jti: tokenId,
      familyId,
      type: 'refresh',
    },
    env.JWT_REFRESH_SECRET,
    {
      expiresIn: env.JWT_REFRESH_EXPIRES_IN,
      algorithm: JWT_ALGORITHM,
    },
  );

const verifyAccessToken = (token) =>
  jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: [JWT_ALGORITHM] });

const verifyRefreshToken = (token) =>
  jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: [JWT_ALGORITHM] });

const getRefreshCookieOptions = () => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: env.NODE_ENV === 'production' ? env.REFRESH_COOKIE_SAME_SITE : 'lax',
  path: '/api/v1/auth',
  maxAge: parseDurationToMs(env.JWT_REFRESH_EXPIRES_IN),
});

const getRefreshExpiryDate = () =>
  new Date(Date.now() + parseDurationToMs(env.JWT_REFRESH_EXPIRES_IN));

module.exports = {
  createTokenId,
  getRefreshCookieOptions,
  getRefreshExpiryDate,
  hashTokenId,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
