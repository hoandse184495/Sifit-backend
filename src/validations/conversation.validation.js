const { z } = require('zod');
const { objectId, pagination, validate } = require('./common.validation');

const createConversationSchema = z.object({
  body: z.object({ productId: objectId }),
});

const conversationIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

const listConversationsSchema = z.object({
  query: z.object(pagination),
});

const readConversationSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ lastReadMessageId: objectId }),
});

module.exports = {
  conversationIdParamSchema,
  createConversationSchema,
  listConversationsSchema,
  readConversationSchema,
  validate,
};
