const express = require('express');
const moderationController = require('../controllers/messageModeration.controller');
const roles = require('../constants/roles');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');
const {
  blockUserSchema,
  listReportsSchema,
  reportMessageSchema,
  resolveReportSchema,
  validate,
} = require('../validations/message.validation');

const router = express.Router();

router.post(
  '/users/:id/block',
  authenticate,
  validate(blockUserSchema),
  moderationController.blockUser,
);
router.delete(
  '/users/:id/block',
  authenticate,
  validate(blockUserSchema),
  moderationController.unblockUser,
);
router.post(
  '/messages/:id/report',
  authenticate,
  validate(reportMessageSchema),
  moderationController.reportMessage,
);
router.get(
  '/admin/reports',
  authenticate,
  authorize(roles.ADMIN),
  validate(listReportsSchema),
  moderationController.listReports,
);
router.get(
  '/admin/message-reports',
  authenticate,
  authorize(roles.ADMIN),
  validate(listReportsSchema),
  moderationController.listReports,
);
router.patch(
  '/admin/message-reports/:id/resolve',
  authenticate,
  authorize(roles.ADMIN),
  validate(resolveReportSchema),
  moderationController.resolveReport,
);

module.exports = router;
