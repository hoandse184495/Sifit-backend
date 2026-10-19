const authorize = require('../middlewares/authorize.middleware');
const roles = require('../constants/roles');
const express = require('express');
const conversationController = require('../controllers/conversation.controller');
const messageController = require('../controllers/message.controller');
const authenticate = require('../middlewares/auth.middleware');
const { chatMessageLimiter } = require('../middlewares/rateLimit.middleware');
const {
  conversationIdParamSchema,
  createConversationSchema,
  listConversationsSchema,
  readConversationSchema,
  validate: validateConversation,
} = require('../validations/conversation.validation');
const {
  listMessagesSchema,
  sendMessageSchema,
  validate: validateMessage,
} = require('../validations/message.validation');

const router = express.Router();

router.use(authenticate);

router.post(
  '/',
  authorize(roles.BUYER),
  chatMessageLimiter,
  validateConversation(createConversationSchema),
  conversationController.createConversation,
);
router.get(
  '/',
  validateConversation(listConversationsSchema),
  conversationController.listConversations,
);
router.get(
  '/:id',
  validateConversation(conversationIdParamSchema),
  conversationController.getConversation,
);
router.get('/:id/messages', validateMessage(listMessagesSchema), messageController.listMessages);
router.post(
  '/:id/messages',
  chatMessageLimiter,
  validateMessage(sendMessageSchema),
  messageController.sendMessage,
);
router.patch(
  '/:id/read',
  validateConversation(readConversationSchema),
  conversationController.markRead,
);

module.exports = router;
