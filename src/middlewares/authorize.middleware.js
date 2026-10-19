const httpStatus = require('../constants/httpStatus');
const ApiError = require('../utils/ApiError');

const authorize =
  (...allowedRoles) =>
  (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return next(new ApiError(httpStatus.FORBIDDEN, 'Insufficient permissions'));
    }

    return next();
  };

module.exports = authorize;
