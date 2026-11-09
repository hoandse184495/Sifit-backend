const { z } = require('zod');
const { objectId, pagination, validate } = require('./common.validation');
const idSchema = z.object({ params: z.object({ id: objectId }) });
const listSchema = z.object({
  query: z.object({
    ...pagination,
    status: z.enum(['OPEN', 'WAITING_TOPUP', 'REFUND_PENDING', 'RESOLVED']).optional(),
  }),
});
const decisionSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      action: z.enum(['WAIT_TOPUP', 'ACCEPT_PAYMENT', 'REFUND_UNALLOCATED']),
      expectedVersion: z.number().int().nonnegative(),
      idempotencyKey: z.uuid(),
      note: z.string().trim().min(10).max(1000),
      confirmStock: z.boolean().default(false),
    })
    .strict()
    .refine(
      (data) => data.action !== 'ACCEPT_PAYMENT' || data.confirmStock,
      'Cần xác nhận đã kiểm tra hàng và người mua đồng ý tiếp tục đơn',
    ),
});
module.exports = { validate, idSchema, listSchema, decisionSchema };
