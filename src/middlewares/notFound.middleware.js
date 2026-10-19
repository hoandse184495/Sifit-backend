const httpStatus = require('../constants/httpStatus');
const ApiError = require('../utils/ApiError');

const notFound = (req, res, next) => {
  next(new ApiError(httpStatus.NOT_FOUND, `Route not found: ${req.originalUrl}`));
};

module.exports = notFound;
