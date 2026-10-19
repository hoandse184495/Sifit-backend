const express = require('express');
const authController = require('../controllers/auth.controller');
const authenticate = require('../middlewares/auth.middleware');
const validateTrustedOrigin = require('../middlewares/origin.middleware');
const {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  validate,
} = require('../validations/auth.validation');

const router = express.Router();

router.post('/register', validate(registerSchema), authController.register);
router.post('/login', validate(loginSchema), authController.login);
router.post('/refresh-token', validateTrustedOrigin, authController.refreshToken);
router.post('/logout', validateTrustedOrigin, authController.logout);
router.get('/me', authenticate, authController.me);
router.patch(
  '/change-password',
  authenticate,
  validateTrustedOrigin,
  validate(changePasswordSchema),
  authController.changePassword,
);

module.exports = router;
