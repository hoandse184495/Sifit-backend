const env = require('../config/env');
const User = require('../models/user.model');
const ApiError = require('../utils/ApiError');
const { verifyAccessToken } = require('../utils/token');

const getToken = (socket) => {
  const authHeader = socket.handshake.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice('Bearer '.length).trim();
  return socket.handshake.auth?.token;
};

const socketAuth = async (socket, next) => {
  try {
    const origin = socket.handshake.headers.origin;
    if (origin && origin !== env.SOCKET_CORS_ORIGIN) {
      throw new ApiError(403, 'Socket origin is not allowed');
    }

    const token = getToken(socket);
    if (!token) throw new ApiError(401, 'Access token is required');

    const payload = verifyAccessToken(token);
    if (payload.type !== 'access' || !payload.sub) throw new ApiError(401, 'Invalid access token');

    const user = await User.findById(payload.sub);
    if (!user) throw new ApiError(401, 'User no longer exists');
    if (user.status === 'SUSPENDED') throw new ApiError(403, 'Account is suspended');

    socket.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = socketAuth;
