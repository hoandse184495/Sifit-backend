const paymentWebhookService = require('../services/paymentWebhook.service');
const asyncHandler = require('../utils/asyncHandler');

const handlePaymentWebhook = asyncHandler(async (req, res) => {
  if (!['payos', 'simulator'].includes(req.params.provider)) throw new (require('../utils/ApiError'))(400, 'Unsupported payment provider');
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
