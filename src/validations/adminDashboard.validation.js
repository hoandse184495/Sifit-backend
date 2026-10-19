const { z } = require('zod');
const { objectId, validate } = require('./common.validation');

const parseDate = z.coerce.date();
const dateRange = {
  startDate: parseDate.optional(),
  endDate: parseDate.optional(),
};

const dateRangeSchema = z.object({ query: z.object(dateRange) }).superRefine((value, ctx) => {
  const { startDate, endDate } = value.query;
  if (startDate && endDate && startDate > endDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['query', 'endDate'],
      message: 'endDate must be after startDate',
    });
  }
});

const analyticsSchema = z
  .object({
    query: z.object({
      ...dateRange,
      groupBy: z.enum(['day', 'week', 'month']).default('day'),
    }),
  })
  .superRefine((value, ctx) => {
    const { startDate, endDate } = value.query;
    if (startDate && endDate && startDate > endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['query', 'endDate'],
        message: 'endDate must be after startDate',
      });
    }
  });

const auditListSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    action: z.string().trim().max(100).optional(),
    resourceType: z.string().trim().max(100).optional(),
    adminId: objectId.optional(),
    ...dateRange,
  }),
});

module.exports = { analyticsSchema, auditListSchema, dateRangeSchema, validate };
