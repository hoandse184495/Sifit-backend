const httpStatus = require('../constants/httpStatus');
const paymentService = require('../services/payment.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const createPayment = asyncHandler(async (req, res) => {
  const payment = await paymentService.createPayment({
    buyer: req.user,
    checkoutGroupId: req.body.checkoutGroupId,
    idempotencyKey: req.body.idempotencyKey,
  });
  const response = new ApiResponse(httpStatus.CREATED, { payment }, 'Payment initiated');

  res.status(response.statusCode).json(response);
});

const getPayment = asyncHandler(async (req, res) => {
  const payment = await paymentService.getPayment(req.params.id, req.user);
  const response = new ApiResponse(httpStatus.OK, { payment }, 'Payment retrieved');

  res.status(response.statusCode).json(response);
});

module.exports = { createPayment, getPayment };
