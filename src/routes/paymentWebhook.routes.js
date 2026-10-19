const express = require('express');
const paymentWebhookController = require('../controllers/paymentWebhook.controller');

const router = express.Router();

router.post('/payments/:provider', paymentWebhookController.handlePaymentWebhook);

module.exports = router;
