const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const { z } = require('zod');
const env = require('../config/env');
const GoogleLoginChallenge = require('../models/googleLoginChallenge.model');
const ApiError = require('../utils/ApiError');

const client = new OAuth2Client();
const NONCE_COOKIE = 'googleLoginNonce';
const NONCE_MAX_AGE = 10 * 60 * 1000;
const hashNonce = (nonce) => crypto.createHash('sha256').update(nonce).digest('hex');
const invalidCredential = () => new ApiError(401, 'Invalid or expired Google sign-in. Please try again.');
const requireConfiguration = () => {
  if (!env.GOOGLE_CLIENT_ID) throw new ApiError(503, 'Google sign-in is not configured yet');
};

const createChallenge = async () => {
  requireConfiguration();
  const nonce = crypto.randomBytes(32).toString('base64url');
  await GoogleLoginChallenge.create({ nonceHash: hashNonce(nonce), expiresAt: new Date(Date.now() + NONCE_MAX_AGE) });
  return nonce;
};

const verifyIdentity = async ({ credential, nonce }) => {
  requireConfiguration();
  if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(nonce)) throw invalidCredential();
  const nonceHash = hashNonce(nonce);
  if (!await GoogleLoginChallenge.exists({ nonceHash, expiresAt: { $gt: new Date() } })) throw invalidCredential();
  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: env.GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch (_error) {
    throw invalidCredential();
  }
  if (!payload || payload.nonce !== nonce || payload.email_verified !== true ||
    typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255 ||
    !z.email().safeParse(payload.email).success) throw invalidCredential();

  const email = payload.email.trim().toLowerCase();
  return {
    googleId: payload.sub,
    email,
    fullName: (typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : email.split('@')[0]).slice(0, 100),
    avatar: typeof payload.picture === 'string' && payload.picture.startsWith('https://') ? payload.picture : undefined,
    nonceHash,
  };
};

const consumeChallenge = async (nonceHash) => {
  const challenge = await GoogleLoginChallenge.findOneAndDelete({ nonceHash, expiresAt: { $gt: new Date() } });
  if (!challenge) throw invalidCredential();
};

module.exports = { NONCE_COOKIE, NONCE_MAX_AGE, createChallenge, verifyIdentity, consumeChallenge };
