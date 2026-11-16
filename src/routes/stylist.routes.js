const router = require('express').Router();
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const authenticate = require('../middlewares/auth.middleware');
const trustedOrigin = require('../middlewares/origin.middleware');
const service = require('../services/stylist.service');
const Job = require('../models/stylistJob.model');
const ApiError = require('../utils/ApiError');
const mongoose = require('mongoose');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 5 } });
router.use(authenticate);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/state', async (req, res) => res.json({ data: await service.state(req.user._id) }));
router.post('/tryon', trustedOrigin, rateLimit({ windowMs: 60000, limit: 5, keyGenerator: req => String(req.user._id), standardHeaders: 'draft-8', legacyHeaders: false }), upload.single('photo'), async (req, res) => {
  const job = await service.create(req.user._id, req.body, req.file);
  res.status(202).json({ data: { job: service.summary(job) } });
  if (job.phase === 'queued') void service.advance(job).catch(() => {});
});
router.get('/jobs/:id', async (req, res) => res.json({ data: { job: await service.get(req.user._id, req.params.id) } }));
router.get('/jobs/:id/image', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Không tìm thấy ảnh.');
  const job = await Job.findOne({ _id: req.params.id, userId: req.user._id, status: 'completed', expiresAt: { $gt: new Date() } }).select('+output');
  if (!job?.output) throw new ApiError(404, 'Không tìm thấy ảnh.');
  res.type('jpeg').send(job.output);
});
router.delete('/jobs/:id', trustedOrigin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Không tìm thấy lượt thử.');
  const job = await Job.findOne({ _id: req.params.id, userId: req.user._id });
  if (!job) throw new ApiError(404, 'Không tìm thấy lượt thử.');
  if (job.active) throw new ApiError(409, 'Hãy chờ lượt thử hoàn tất trước khi xóa ảnh.');
  // Keep the idempotency receipt and budget; remove private image data immediately.
  await Job.updateOne({ _id: job._id }, { $unset: { photo: 1, output: 1 }, status: 'deleted' });
  res.json({ data: { success: true } });
});
module.exports = router;
