const env = require('../config/env');
const httpStatus = require('../constants/httpStatus');

const errorHandler = (err, req, res, _next) => {
  const isDuplicateKeyError = err.code === 11000;
  const isMulterFileSizeError = err.code === 'LIMIT_FILE_SIZE';
  const statusCode = isDuplicateKeyError
    ? httpStatus.CONFLICT
    : isMulterFileSizeError
      ? 413
      : err.statusCode || httpStatus.INTERNAL_SERVER_ERROR;
  const message = isDuplicateKeyError
    ? 'Resource already exists'
    : isMulterFileSizeError
      ? 'Uploaded file is too large'
      : statusCode === httpStatus.INTERNAL_SERVER_ERROR && env.NODE_ENV === 'production'
        ? 'Internal server error'
        : err.message || 'Internal server error';

  const response = {
    success: false,
    message,
    errors: Array.isArray(err.errors) ? err.errors : [],
  };

  if (env.NODE_ENV !== 'production' && err.stack) {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
};

module.exports = errorHandler;
