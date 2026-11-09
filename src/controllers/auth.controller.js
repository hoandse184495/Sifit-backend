const httpStatus = require('../constants/httpStatus');
const authService = require('../services/auth.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { getRefreshCookieOptions } = require('../utils/token');
const env = require('../config/env');
const googleIdentity = require('../services/googleIdentity.service');

const googleCookieOptions = () => ({ ...getRefreshCookieOptions(), maxAge: googleIdentity.NONCE_MAX_AGE });
const googleConfig = asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!env.GOOGLE_CLIENT_ID) {
    return res.json(new ApiResponse(200, { enabled: false }, 'Google sign-in is not configured yet'));
  }
  const nonce = await googleIdentity.createChallenge();
  res.cookie(googleIdentity.NONCE_COOKIE, nonce, googleCookieOptions());
  return res.json(new ApiResponse(200, { enabled: true, clientId: env.GOOGLE_CLIENT_ID, nonce }, 'Google sign-in ready'));
});

const googleLogin = asyncHandler(async (req, res) => {
  const result = await authService.googleLogin({ ...req.body, nonce: req.cookies[googleIdentity.NONCE_COOKIE], req });
  setRefreshCookie(res, result.refreshToken);
  res.clearCookie(googleIdentity.NONCE_COOKIE, { ...googleCookieOptions(), maxAge: undefined });
  res.set('Cache-Control', 'no-store');
  res.json(new ApiResponse(200, { user: result.user, accessToken: result.accessToken }, 'Google login successful'));
});

const setRefreshCookie = (res, refreshToken) => {
  res.cookie('refreshToken', refreshToken, getRefreshCookieOptions());
};

const clearRefreshCookie = (res) => {
  res.clearCookie('refreshToken', {
    ...getRefreshCookieOptions(),
    maxAge: undefined,
  });
};

const register = asyncHandler(async (req, res) => {
  const user = await authService.register(req.body);
  const response = new ApiResponse(httpStatus.CREATED, { user }, 'Registration successful');

  res.status(response.statusCode).json(response);
});

const login = asyncHandler(async (req, res) => {
  const result = await authService.login({ ...req.body, req });
  setRefreshCookie(res, result.refreshToken);

  const response = new ApiResponse(
    httpStatus.OK,
    {
      user: result.user,
      accessToken: result.accessToken,
    },
    'Login successful',
  );

  res.status(response.statusCode).json(response);
});

const refreshToken = asyncHandler(async (req, res) => {
  const result = await authService.refreshToken({
    token: req.cookies.refreshToken,
    req,
  });
  setRefreshCookie(res, result.refreshToken);

  const response = new ApiResponse(
    httpStatus.OK,
    {
      user: result.user,
      accessToken: result.accessToken,
    },
    'Token refreshed',
  );

  res.status(response.statusCode).json(response);
});

const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.cookies.refreshToken);
  clearRefreshCookie(res);

  const response = new ApiResponse(httpStatus.OK, {}, 'Logout successful');
  res.status(response.statusCode).json(response);
});

const me = asyncHandler(async (req, res) => {
  const user = await authService.getCurrentUser(req.user.id);
  const response = new ApiResponse(httpStatus.OK, { user }, 'Current user retrieved');

  res.status(response.statusCode).json(response);
});

const changePassword = asyncHandler(async (req, res) => {
  await authService.changePassword({
    userId: req.user.id,
    currentPassword: req.body.currentPassword,
    newPassword: req.body.newPassword,
  });
  clearRefreshCookie(res);

  const response = new ApiResponse(
    httpStatus.OK,
    {},
    'Password changed successfully. Please log in again.',
  );

  res.status(response.statusCode).json(response);
});

module.exports = {
  googleConfig,
  googleLogin,
  changePassword,
  login,
  logout,
  me,
  refreshToken,
  register,
};
