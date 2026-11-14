const express = require('express');
const aiStylistController = require('../controllers/aiStylist.controller');
const ApiError = require('../utils/ApiError');

const router = express.Router();

router.get('/prompts', aiStylistController.getPrompts);

router.post(
  '/recommend',
  (req, _res, next) => {
    const message = String(req.body?.message || '').trim();
    if (!message || message.length > 1000) {
      return next(new ApiError(400, 'Please enter a styling question between 1 and 1000 characters'));
    }
    return next();
  },
  aiStylistController.recommend,
);

module.exports = router;
