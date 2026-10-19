const argon2 = require('argon2');
const crypto = require('crypto');
const httpStatus = require('../constants/httpStatus');
const roles = require('../constants/roles');
const AuthSession = require('../models/authSession.model');
const User = require('../models/user.model');
const ApiError = require('../utils/ApiError');
const {
  createTokenId,
  getRefreshExpiryDate,
  hashTokenId,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} = require('../utils/token');

const safeUser = (user) => ({
  id: user.id,
  fullName: user.fullName,
  email: user.email,
  role: user.role,
  status: user.status,
  avatar: user.avatar,
  phone: user.phone,
  emailVerified: user.emailVerified,
  lastLoginAt: user.lastLoginAt,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const hashPassword = (password) =>
  argon2.hash(password, {
    type: argon2.argon2id,
  });

const createRefreshSession = async ({
  user,
  req,
  familyId = crypto.randomUUID(),
  previousTokenIdHash,
}) => {
  const tokenId = createTokenId();
  const tokenIdHash = hashTokenId(tokenId);

  await AuthSession.create({
    user: user._id,
    familyId,
    tokenIdHash,
    previousTokenIdHash,
    expiresAt: getRefreshExpiryDate(),
    userAgent: req.get('user-agent'),
    ipAddress: req.ip,
  });

  const refreshToken = signRefreshToken({
    userId: user.id,
    tokenId,
    familyId,
  });

  return { refreshToken, tokenIdHash, familyId };
};

const register = async ({ fullName, email, password, role = roles.BUYER }) => {
  if (![roles.BUYER, roles.SELLER].includes(role)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Only buyer or seller registration is allowed');
  }
  const normalizedEmail = email.toLowerCase();
  const existingUser = await User.exists({ email: normalizedEmail });

  if (existingUser) {
    throw new ApiError(httpStatus.CONFLICT, 'Email is already registered');
  }

  const passwordHash = await hashPassword(password);
  const user = await User.create({
    fullName,
    email: normalizedEmail,
    passwordHash,
    role,
  });

  return safeUser(user);
};

const login = async ({ email, password, req }) => {
  const normalizedEmail = email.toLowerCase();
  const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');

  if (!user) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid email or password');
  }

  const passwordMatches = await argon2.verify(user.passwordHash, password);

  if (!passwordMatches) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid email or password');
  }

  if (user.status === 'SUSPENDED') {
    throw new ApiError(httpStatus.FORBIDDEN, 'Account is suspended');
  }

  user.lastLoginAt = new Date();
  await user.save();

  const accessToken = signAccessToken(user);
  const { refreshToken } = await createRefreshSession({ user, req });

  return {
    user: safeUser(user),
    accessToken,
    refreshToken,
  };
};

const refreshToken = async ({ token, req }) => {
  if (!token) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Refresh token is required');
  }

  let payload;

  try {
    payload = verifyRefreshToken(token);
  } catch (_error) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid refresh token');
  }

  if (payload.type !== 'refresh' || !payload.jti || !payload.familyId || !payload.sub) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid refresh token');
  }

  const tokenIdHash = hashTokenId(payload.jti);
  const session = await AuthSession.findOne({ tokenIdHash });

  if (!session) {
    await AuthSession.updateMany(
      { familyId: payload.familyId, revokedAt: null },
      { revokedAt: new Date(), revokedReason: 'refresh_token_reuse_detected' },
    );
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid refresh token');
  }

  if (session.revokedAt) {
    await AuthSession.updateMany(
      { familyId: session.familyId, revokedAt: null },
      { revokedAt: new Date(), revokedReason: 'refresh_token_reuse_detected' },
    );
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid refresh token');
  }

  if (session.expiresAt <= new Date()) {
    session.revokedAt = new Date();
    session.revokedReason = 'expired';
    await session.save();
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Refresh token expired');
  }

  const user = await User.findById(payload.sub);

  if (!user || user.status === 'SUSPENDED') {
    await AuthSession.updateMany(
      { familyId: session.familyId, revokedAt: null },
      { revokedAt: new Date(), revokedReason: 'user_unavailable' },
    );
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid refresh token');
  }

  session.revokedAt = new Date();
  session.revokedReason = 'rotated';

  const rotatedSession = await createRefreshSession({
    user,
    req,
    familyId: session.familyId,
    previousTokenIdHash: tokenIdHash,
  });

  session.replacedByTokenIdHash = rotatedSession.tokenIdHash;
  await session.save();

  return {
    user: safeUser(user),
    accessToken: signAccessToken(user),
    refreshToken: rotatedSession.refreshToken,
  };
};

const logout = async (token) => {
  if (!token) {
    return;
  }

  try {
    const payload = verifyRefreshToken(token);

    if (payload.jti) {
      await AuthSession.updateOne(
        { tokenIdHash: hashTokenId(payload.jti), revokedAt: null },
        { revokedAt: new Date(), revokedReason: 'logout' },
      );
    }
  } catch (_error) {
    // Repeated logout and malformed cookies are intentionally safe no-ops.
  }
};

const getCurrentUser = async (userId) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'User no longer exists');
  }

  if (user.status === 'SUSPENDED') {
    throw new ApiError(httpStatus.FORBIDDEN, 'Account is suspended');
  }

  return safeUser(user);
};

const changePassword = async ({ userId, currentPassword, newPassword }) => {
  const user = await User.findById(userId).select('+passwordHash');

  if (!user) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'User no longer exists');
  }

  const passwordMatches = await argon2.verify(user.passwordHash, currentPassword);

  if (!passwordMatches) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid current password');
  }

  user.passwordHash = await hashPassword(newPassword);
  await user.save();

  await AuthSession.updateMany(
    { user: user._id, revokedAt: null },
    { revokedAt: new Date(), revokedReason: 'password_changed' },
  );
};

module.exports = {
  changePassword,
  getCurrentUser,
  login,
  logout,
  refreshToken,
  register,
  safeUser,
};
