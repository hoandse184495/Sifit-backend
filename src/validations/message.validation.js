const { z } = require('zod');
const { objectId, uuid, validate } = require('./common.validation');

const sendMessageBodySchema = z
  .object({
    clientMessageId: uuid,
    type: z.enum(['TEXT', 'IMAGE']).default('TEXT'),
    content: z.string().trim().max(2000).optional(),
    attachments: z
      .array(
        z.object({
          url: z.url(),
          publicId: z.string().trim().max(300).optional(),
          mimeType: z.string().trim().max(100).optional(),
          size: z.coerce.number().int().min(0).optional(),
        }),
      )
      .max(5)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'TEXT' && !value.content) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: 'Text message content is required',
      });
    }
    if (value.type === 'IMAGE' && !value.attachments?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attachments'],
        message: 'Image message requires at least one attachment',
      });
    }
  });

const listMessagesSchema = z.object({
  params: z.object({ id: objectId }),
  query: z.object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    before: objectId.optional(),
  }),
});

const sendMessageSchema = z.object({
  params: z.object({ id: objectId }),
  body: sendMessageBodySchema,
});

const reportMessageSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ reason: z.string().trim().min(1).max(1000) }),
});

const blockUserSchema = z.object({
  params: z.object({ id: objectId }),
});

const listReportsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    status: z.enum(['OPEN', 'RESOLVED']).optional(),
  }),
});

const resolveReportSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ resolutionNote: z.string().trim().min(1).max(1000) }),
});

module.exports = {
  blockUserSchema,
  listMessagesSchema,
  listReportsSchema,
  reportMessageSchema,
  resolveReportSchema,
  sendMessageBodySchema,
  sendMessageSchema,
  validate,
};
