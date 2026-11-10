const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const authenticate = require('../middlewares/auth.middleware');
const validateOrigin = require('../middlewares/origin.middleware');
const { validate } = require('../validations/common.validation');
const { registerSchema } = require('../validations/auth.validation');
const asyncHandler = require('../utils/asyncHandler');
const service = require('../services/emailAction.service');
const router = express.Router();
const limiter = rateLimit({ windowMs: 15 * 60000, limit: 5, standardHeaders: true, legacyHeaders: false });
const token = z.string().regex(/^[a-f0-9]{64}$/);
const generic = 'Nếu tài khoản phù hợp, email hướng dẫn sẽ được gửi. Vui lòng kiểm tra cả thư rác.';
router.post('/auth/forgot-password', limiter, validate(z.object({ body: z.object({ email: z.email().transform(v => v.trim().toLowerCase()) }) })), asyncHandler(async (req, res) => {
  await service.issue(req.body.email, 'reset'); res.json({ success: true, message: generic });
}));
router.post('/auth/reset-password', limiter, validate(z.object({ body: z.object({ token, newPassword: registerSchema.shape.body.shape.password }) })), asyncHandler(async (req, res) => {
  await service.consume('reset', req.body.token, req.body.newPassword); res.json({ success: true, message: 'Đã đổi mật khẩu. Vui lòng đăng nhập lại.' });
}));
router.post('/auth/email-verification', limiter, authenticate, validateOrigin, asyncHandler(async (req, res) => {
  await service.issue(req.user.email, 'verify'); res.json({ success: true, message: generic });
}));
router.post('/auth/verify-email', limiter, validate(z.object({ body: z.object({ token }) })), asyncHandler(async (req, res) => {
  await service.consume('verify', req.body.token); res.json({ success: true, message: 'Email đã được xác minh.' });
}));
module.exports = router;
