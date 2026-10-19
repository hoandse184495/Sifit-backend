const express = require('express');
const adminReviewController = require('../controllers/adminReview.controller');
const roles = require('../constants/roles');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');

const router = express.Router();

router.use(authenticate, authorize(roles.ADMIN));

router.get('/reviews', adminReviewController.listReviews);
router.patch('/reviews/:id/hide', adminReviewController.hideReview);
router.patch('/reviews/:id/restore', adminReviewController.restoreReview);

module.exports = router;
