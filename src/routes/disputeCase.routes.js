const express = require('express');
const multer = require('multer');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const service = require('../services/disputeCase.service');
const schemas = require('../validations/disputeCase.validation');
const { validate } = schemas;
const router = express.Router();
const reply = (fn, status = 200) =>
  asyncHandler(async (req, res) =>
    res.status(status).json(new ApiResponse(status, await fn(req), 'Dispute case updated')),
  );
const parse = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 2, fieldSize: 2000 },
}).single('evidence');
const upload = (req, res, next) =>
  parse(req, res, (error) => {
    if (error instanceof multer.MulterError)
      return next(
        new ApiError(
          error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
          error.code === 'LIMIT_FILE_SIZE'
            ? 'Ảnh tối đa 5 MB.'
            : 'Chọn đúng một ảnh cùng mô tả và loại bằng chứng.',
        ),
      );
    return next(error);
  });
router.get(
  '/disputes/:id/messages',
  authenticate,
  validate(schemas.listSchema),
  reply((req) => service.listMessages(req.user, req.params.id, req.query)),
);
router.post(
  '/disputes/:id/messages',
  authenticate,
  validate(schemas.messageSchema),
  reply(
    async (req) => ({ message: await service.postMessage(req.user, req.params.id, req.body) }),
    201,
  ),
);
router.get(
  '/disputes/:id/evidence',
  authenticate,
  validate(schemas.idSchema),
  reply((req) => service.listEvidence(req.user, req.params.id)),
);
// Authorize case ownership before accepting a multipart file into memory.
router.post(
  '/disputes/:id/evidence',
  authenticate,
  validate(schemas.idSchema),
  asyncHandler(async (req, res, next) => {
    await service.getCase(req.params.id, req.user);
    next();
  }),
  upload,
  validate(schemas.evidenceSchema),
  reply(
    async (req) => ({
      evidence: await service.uploadEvidence(req.user, req.params.id, req.file, req.body),
    }),
    201,
  ),
);
router.get(
  '/disputes/:id/evidence/:fileId',
  authenticate,
  validate(schemas.fileSchema),
  asyncHandler(async (req, res) => {
    const file = await service.getEvidenceFile(req.user, req.params.id, req.params.fileId);
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[file.mimeType];
    res
      .set({
        'Content-Type': file.mimeType,
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="dispute-evidence.${ext}"`,
      })
      .send(file.data);
  }),
);
router.post(
  '/disputes/:id/return-shipment',
  authenticate,
  authorize('BUYER'),
  validate(schemas.shipmentSchema),
  reply(async (req) => ({
    dispute: await service.submitReturnShipment(req.user, req.params.id, req.body),
  })),
);
router.post(
  '/disputes/:id/return-receipt',
  authenticate,
  authorize('SELLER'),
  validate(schemas.receiptSchema),
  reply(async (req) => ({
    dispute: await service.confirmReturnReceipt(req.user, req.params.id, req.body),
  })),
);
router.post(
  '/admin/disputes/:id/verify-return',
  authenticate,
  authorize('ADMIN'),
  validate(schemas.verifySchema),
  reply(async (req) => ({
    dispute: await service.verifyReturn(req.user, req.params.id, req.body),
  })),
);
module.exports = router;
