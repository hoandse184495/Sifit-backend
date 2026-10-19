const env = require('../config/env');
const httpStatus = require('../constants/httpStatus');
const ApiError = require('../utils/ApiError');

const validateTrustedOrigin = (req, res, next) => {
  if (env.NODE_ENV === 'test') {
    return next();
  }

  const origin = req.get('origin');

  if (!origin || origin === env.FRONTEND_URL) {
    return next();
  }

  return next(new ApiError(httpStatus.FORBIDDEN, 'Untrusted request origin'));
};

module.exports = validateTrustedOrigin;
