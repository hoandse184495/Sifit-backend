const httpStatus = require('../constants/httpStatus');
const User = require('../models/user.model');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { verifyAccessToken } = require('../utils/token');

const authenticate = asyncHandler(async (req, res, next) => {
  const authHeader = req.get('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Access token is required');
  }

  const token = authHeader.slice('Bearer '.length).trim();
  let payload;

  try {
    payload = verifyAccessToken(token);
  } catch (_error) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid or expired access token');
  }

  if (payload.type !== 'access' || !payload.sub) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid access token');
  }

  const user = await User.findById(payload.sub);

  if (!user) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'User no longer exists');
  }

  if (user.status === 'SUSPENDED') {
    throw new ApiError(httpStatus.FORBIDDEN, 'Account is suspended');
  }

  req.user = user;
  next();
});

module.exports = authenticate;
