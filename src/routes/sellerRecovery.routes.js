const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');
const { validate, objectId, pagination } = require('../validations/common.validation');
const asyncHandler = require('../utils/asyncHandler');
const service = require('../services/sellerRecovery.service');
const Recovery = require('../models/sellerRecovery.model');
const Receipt = require('../models/recoveryReceipt.model');
const router = express.Router();
const idParams = z.object({ id: objectId });
const reason = z.object({ reason: z.string().trim().min(10).max(1000) });
const send = action => asyncHandler(async (req, res) => res.json({ success: true, data: await action(req) }));
for (const role of ['ADMIN', 'SELLER']) {
  const prefix = `/${role.toLowerCase()}/recoveries`;
  router.get(prefix, authenticate, authorize(role), validate(z.object({ query: z.object(pagination) })), send(async req => {
    const query = role === 'SELLER' ? { sellerId: req.user._id } : {};
    const { page, limit } = req.query; const total = await Recovery.countDocuments(query);
    return { items: await Recovery.find(query).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }));
  router.get(`${prefix}/:id`, authenticate, authorize(role), validate(z.object({ params: idParams })), send(req => service.get(req.user, req.params.id)));
  router.get(`${prefix}/:id/receipts/:receiptId/proof`, authenticate, authorize(role), validate(z.object({ params: idParams.extend({ receiptId: objectId }) })), asyncHandler(async (req, res) => {
    await service.get(req.user, req.params.id);
    const receipt = await Receipt.findOne({ _id: req.params.receiptId, recoveryId: req.params.id }).select('+proof');
    if (!receipt) return res.sendStatus(404);
    res.set({ 'Content-Type': receipt.mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).send(receipt.proof);
  }));
}
router.post('/admin/orders/:id/post-payout-dispute', authenticate, authorize('ADMIN'), validate(z.object({ params: idParams, body: reason })), send(async req => ({ dispute: await service.openLateCase(req.user, req.params.id, req.body) })));
router.post('/admin/recoveries', authenticate, authorize('ADMIN'), validate(z.object({ body: reason.extend({ orderId: objectId }) })), send(async req => ({ recovery: await service.create(req.user, req.body.orderId, req.body.reason) })));
router.post('/admin/recoveries/:id/receipts', authenticate, authorize('ADMIN'), multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5 } }).single('proof'), validate(z.object({ params: idParams, body: z.object({ amount: z.coerce.number().int().positive().safe(), reference: z.string().trim().min(3).max(100), receivedAt: z.iso.datetime(), note: z.string().trim().min(10).max(1000), confirmed: z.literal('true').transform(() => true) }) })), send(async req => ({ recovery: await service.recordReceipt(req.user, req.params.id, req.body, req.file) })));
module.exports = router;
