const express = require('express');
const { URL } = require('node:url');
const authController = require('../controllers/auth.controller');
const profileController = require('../controllers/profile.controller');
const { updateProfileSchema } = require('../validations/profile.validation');
const { uploadAvatar } = require('../middlewares/upload.middleware');
const authenticate = require('../middlewares/auth.middleware');
const validateTrustedOrigin = require('../middlewares/origin.middleware');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const {
  loginLimiter,
  loginIdentityLimiter,
  googleLoginLimiter,
  registerLimiter,
  authSessionLimiter,
} = require('../middlewares/rateLimit.middleware');
const {
  changePasswordSchema,
  googleLoginSchema,
  loginSchema,
  registerSchema,
  validate,
} = require('../validations/auth.validation');

const router = express.Router();

router.get('/google/config', authController.googleConfig);
router.post(
  '/google',
  (req, _res, next) => {
    // JSON callback flow: require our browser origin as well as the one-use, cookie-bound ID-token nonce.
    if (req.get('origin') !== new URL(env.FRONTEND_URL).origin)
      return next(new ApiError(403, 'Untrusted request origin'));
    return next();
  },
  googleLoginLimiter,
  validate(googleLoginSchema),
  authController.googleLogin,
);

router.post('/register', registerLimiter, validate(registerSchema), authController.register);
router.post(
  '/login',
  loginLimiter,
  loginIdentityLimiter,
  validate(loginSchema),
  authController.login,
);
router.post(
  '/refresh-token',
  authSessionLimiter,
  validateTrustedOrigin,
  authController.refreshToken,
);
router.post('/logout', authSessionLimiter, validateTrustedOrigin, authController.logout);
router.get('/me', authenticate, authController.me);
router.patch(
  '/me',
  authenticate,
  validateTrustedOrigin,
  validate(updateProfileSchema),
  profileController.updateProfile,
);
router.post(
  '/me/avatar',
  authenticate,
  validateTrustedOrigin,
  uploadAvatar,
  profileController.uploadAvatar,
);
router.delete('/me/avatar', authenticate, validateTrustedOrigin, profileController.deleteAvatar);
router.patch(
  '/change-password',
  authenticate,
  validateTrustedOrigin,
  validate(changePasswordSchema),
  authController.changePassword,
);

module.exports = router;
