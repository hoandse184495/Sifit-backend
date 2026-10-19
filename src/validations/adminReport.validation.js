const { z } = require('zod');
const { validate } = require('./common.validation');

const exportSchema = z
  .object({
    query: z.object({
      startDate: z.coerce.date().optional(),
      endDate: z.coerce.date().optional(),
      limit: z.coerce.number().int().min(1).max(5000).default(1000),
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

module.exports = { exportSchema, validate };
