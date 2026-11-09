const express = require('express');
const sellerVerificationController = require('../controllers/sellerVerification.controller');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');
const roles = require('../constants/roles');
const schemas = require('../validations/sellerVerification.validation');
const { validate } = schemas;
const service = require('../services/sellerVerification.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const multer = require('multer');
const reply = (fn, status = 200) =>
  asyncHandler(async (req, res) =>
    res.status(status).json(new ApiResponse(status, await fn(req), 'Verification updated')),
  );
const parse = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
}).single('document');
const upload = (req, res, next) =>
  parse(req, res, (error) =>
    next(
      error instanceof multer.MulterError
        ? new ApiError(
            error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
            'Chọn đúng một ảnh tối đa 5 MB bằng trường document.',
          )
        : error,
    ),
  );

const router = express.Router();
router.post(
  '/seller/verification/draft',
  authenticate,
  validate(schemas.draftSchema),
  reply(async (req) => ({ verification: await service.createDraft(req.user, req.body) }), 201),
);
router.put(
  '/seller/verification/:id',
  authenticate,
  validate(schemas.updateSchema),
  reply(async (req) => ({
    verification: await service.updateDraft(req.user, req.params.id, req.body),
  })),
);
router.get(
  '/seller-verifications/:id',
  authenticate,
  validate(schemas.idSchema),
  reply((req) => service.detail(req.user, req.params.id)),
);
router.post(
  '/seller/verification/:id/documents/:kind',
  authenticate,
  validate(schemas.documentSchema),
  asyncHandler(async (req, res, next) => {
    await service.getCase(req.user, req.params.id);
    next();
  }),
  upload,
  reply(
    async (req) => ({
      document: await service.uploadDocument(req.user, req.params.id, req.params.kind, req.file),
    }),
    201,
  ),
);
router.delete(
  '/seller/verification/:id/documents/:kind',
  authenticate,
  validate(schemas.documentSchema),
  reply(async (req) => ({
    verification: await service.removeDocument(req.user, req.params.id, req.params.kind),
  })),
);
router.get(
  '/seller-verifications/:id/documents/:kind',
  authenticate,
  validate(schemas.documentSchema),
  asyncHandler(async (req, res) => {
    const file = await service.documentFile(req.user, req.params.id, req.params.kind);
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[file.mimeType];
    res
      .set({
        'Content-Type': file.mimeType,
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="sifit-verification-${req.params.kind}.${ext}"`,
      })
      .send(file.data);
  }),
);

router.post(
  '/seller/verification/submit',
  authenticate,
  validate(schemas.submitSchema),
  sellerVerificationController.submitVerification,
);
router.get('/seller/verification/status', authenticate, sellerVerificationController.getStatus);
router.get(
  '/admin/seller-verifications',
  authenticate,
  authorize(roles.ADMIN),
  validate(schemas.listSchema),
  sellerVerificationController.listPending,
);
router.patch(
  '/admin/seller-verifications/:id/approve',
  authenticate,
  authorize(roles.ADMIN),
  validate(schemas.reviewSchema),
  sellerVerificationController.approve,
);
router.patch(
  '/admin/seller-verifications/:id/reject',
  authenticate,
  authorize(roles.ADMIN),
  validate(schemas.reviewSchema),
  sellerVerificationController.reject,
);

module.exports = router;
