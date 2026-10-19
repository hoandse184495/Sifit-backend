const httpStatus = require('../constants/httpStatus');
const notificationService = require('../services/notification.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const listNotifications = asyncHandler(async (req, res) => {
  const result = await notificationService.listNotifications(req.user, req.query);
  const response = new ApiResponse(httpStatus.OK, result, 'Notifications retrieved');

  res.status(response.statusCode).json(response);
});

const unreadCount = asyncHandler(async (req, res) => {
  const count = await notificationService.unreadCount(req.user);
  const response = new ApiResponse(
    httpStatus.OK,
    { unreadCount: count },
    'Unread notification count retrieved',
  );

  res.status(response.statusCode).json(response);
});

const markRead = asyncHandler(async (req, res) => {
  const notification = await notificationService.markRead(req.user, req.params.id);
  const response = new ApiResponse(httpStatus.OK, { notification }, 'Notification marked as read');

  res.status(response.statusCode).json(response);
});

const markAllRead = asyncHandler(async (req, res) => {
  const result = await notificationService.markAllRead(req.user);
  const response = new ApiResponse(httpStatus.OK, result, 'Notifications marked as read');

  res.status(response.statusCode).json(response);
});

const archiveNotification = asyncHandler(async (req, res) => {
  const notification = await notificationService.archiveNotification(req.user, req.params.id);
  const response = new ApiResponse(httpStatus.OK, { notification }, 'Notification archived');

  res.status(response.statusCode).json(response);
});

module.exports = { archiveNotification, listNotifications, markAllRead, markRead, unreadCount };
