const { z } = require('zod');
const { objectId, pagination, validate } = require('./common.validation');

const listNotificationsSchema = z.object({
  query: z.object({
    ...pagination,
    isRead: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === 'true')),
  }),
});

const notificationIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

const updatePreferencesSchema = z.object({
  body: z
    .object({
      inAppEnabled: z.boolean().optional(),
      messageNotifications: z.boolean().optional(),
      orderNotifications: z.boolean().optional(),
      productNotifications: z.boolean().optional(),
      shippingNotifications: z.boolean().optional(),
      reviewNotifications: z.boolean().optional(),
      payoutNotifications: z.boolean().optional(),
    })
    .refine((value) => Object.keys(value).length > 0),
});

module.exports = {
  listNotificationsSchema,
  notificationIdParamSchema,
  updatePreferencesSchema,
  validate,
};
