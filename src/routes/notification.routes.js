const express = require('express');
const notificationController = require('../controllers/notification.controller');
const preferenceController = require('../controllers/notificationPreference.controller');
const authenticate = require('../middlewares/auth.middleware');
const {
  listNotificationsSchema,
  notificationIdParamSchema,
  updatePreferencesSchema,
  validate,
} = require('../validations/notification.validation');

const router = express.Router();

router.use(authenticate);

router.get('/', validate(listNotificationsSchema), notificationController.listNotifications);
router.get('/unread-count', notificationController.unreadCount);
router.get('/preferences', preferenceController.getPreferences);
router.patch(
  '/preferences',
  validate(updatePreferencesSchema),
  preferenceController.updatePreferences,
);
router.patch('/read-all', notificationController.markAllRead);
router.patch('/:id/read', validate(notificationIdParamSchema), notificationController.markRead);
router.delete(
  '/:id',
  validate(notificationIdParamSchema),
  notificationController.archiveNotification,
);

module.exports = router;
