const express = require('express');
const multer = require('multer');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const service = require('../services/manualRefund.service');
const schemas = require('../validations/manualRefund.validation');
const { validate } = schemas;
const router = express.Router();
const admin = [authenticate, authorize('ADMIN')];
const member = [authenticate, authorize('BUYER', 'ADMIN')];
const respond = (handler, status = 200) =>
  asyncHandler(async (req, res) =>
    res.status(status).json(new ApiResponse(status, await handler(req), 'Refund updated')),
  );
const parseProof = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
}).single('proof');
const upload = (req, res, next) =>
  parseProof(req, res, (error) => {
    if (error instanceof multer.MulterError)
      return next(
        new ApiError(
          error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
          error.code === 'LIMIT_FILE_SIZE'
            ? 'Chứng từ tối đa 5 MB.'
            : 'Chọn đúng một ảnh chứng từ bằng trường proof.',
        ),
      );
    return next(error);
  });
router.get(
  '/admin/manual-refunds/payment/:id/context',
  ...admin,
  validate(schemas.idSchema),
  respond((req) => service.context(req.params.id)),
);
router.get(
  '/admin/manual-refunds',
  ...admin,
  validate(schemas.listSchema),
  respond((req) => service.list(req.user, req.query)),
);
router.post(
  '/admin/manual-refunds',
  ...admin,
  validate(schemas.createSchema),
  respond(async (req) => ({ refund: await service.create(req.user, req.body) }), 201),
);
router.get(
  '/refunds',
  ...member,
  validate(schemas.listSchema),
  respond((req) => service.list(req.user, req.query)),
);
router.get(
  '/refunds/:id',
  ...member,
  validate(schemas.idSchema),
  respond(async (req) => ({ refund: await service.get(req.user, req.params.id) })),
);
router.put(
  '/refunds/:id/bank',
  authenticate,
  authorize('BUYER'),
  validate(schemas.bankSchema),
  respond(async (req) => {
    const bank = { ...req.body };
    delete bank.ownsAccount;
    return { refund: await service.saveBank(req.user, req.params.id, bank) };
  }),
);
router.post(
  '/admin/manual-refunds/:id/approve',
  ...admin,
  validate(schemas.approveSchema),
  respond(async (req) => ({
    refund: await service.approve(req.user, req.params.id, req.body.expectedVersion),
  })),
);
router.post(
  '/admin/manual-refunds/:id/cancel',
  ...admin,
  validate(schemas.cancelSchema),
  respond(async (req) => ({
    refund: await service.cancel(req.user, req.params.id, req.body.note),
  })),
);
router.post(
  '/admin/manual-refunds/:id/proof',
  ...admin,
  validate(schemas.idSchema),
  upload,
  respond(async (req) => ({
    refund: await service.uploadProof(req.user, req.params.id, req.file),
  })),
);
router.post(
  '/admin/manual-refunds/:id/record-transfer',
  ...admin,
  validate(schemas.transferSchema),
  respond(async (req) => ({ refund: await service.complete(req.user, req.params.id, req.body) })),
);
router.get(
  '/refunds/:id/proof',
  ...member,
  validate(schemas.idSchema),
  asyncHandler(async (req, res) => {
    const proof = await service.getProof(req.user, req.params.id);
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[
      proof.mimeType
    ];
    res
      .set({
        'Content-Type': proof.mimeType,
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="refund-receipt.${extension}"`,
      })
      .send(proof.data);
  }),
);
router.post(
  '/admin/manual-refunds/:id/request-bank-correction',
  ...admin,
  validate(schemas.correctionSchema),
  respond(async (req) => ({
    refund: await service.requestBankCorrection(req.user, req.params.id, req.body.note),
  })),
);
module.exports = router;
