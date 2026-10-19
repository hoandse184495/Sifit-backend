const rateLimit = require('express-rate-limit');
const httpStatus = require('../constants/httpStatus');

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(httpStatus.TOO_MANY_REQUESTS).json({
      success: false,
      message: 'Too many requests, please try again later',
      errors: [],
    });
  },
});

const chatMessageLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(httpStatus.TOO_MANY_REQUESTS).json({
      success: false,
      message: 'Too many chat actions, please try again later',
      errors: [],
    });
  },
});

module.exports = {
  apiLimiter,
  chatMessageLimiter,
};
