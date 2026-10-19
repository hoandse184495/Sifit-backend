const paymentWebhookService = require('../services/paymentWebhook.service');
const asyncHandler = require('../utils/asyncHandler');

const handlePaymentWebhook = asyncHandler(async (req, res) => {
  const result = await paymentWebhookService.handleWebhook({
    providerName: req.params.provider,
    payload: req.body,
    signature: req.get('x-sifit-signature'),
  });

  res.status(200).json({
    success: true,
    message: 'Webhook processed',
    data: result,
  });
});

module.exports = { handlePaymentWebhook };
