const express = require('express');
const payoutController = require('../controllers/payout.controller');
const authenticate = require('../middlewares/auth.middleware');
const { idParamSchema, listSchema, validate } = require('../validations/payout.validation');

const router = express.Router();

router.use(authenticate);

router.get('/earnings', payoutController.getEarnings);
router.get('/payouts', validate(listSchema), payoutController.listPayouts);
router.get('/payouts/:id', validate(idParamSchema), payoutController.getPayout);

module.exports = router;
