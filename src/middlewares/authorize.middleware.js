const httpStatus = require('../constants/httpStatus');
const ApiError = require('../utils/ApiError');

const authorize =
  (...allowedRoles) =>
  (req, res, next) => {
    // Sellers retain member shopping capabilities alongside their shop permissions.
    const canShop = req.user?.role === 'SELLER' && allowedRoles.includes('BUYER');
    if (!req.user || (!allowedRoles.includes(req.user.role) && !canShop)) {
      return next(new ApiError(httpStatus.FORBIDDEN, 'Insufficient permissions'));
    }

    return next();
  };

module.exports = authorize;
