const httpStatus = require('../constants/httpStatus');
const shippingService = require('../services/shipping.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const quote = asyncHandler(async (req, res) => {
  const quoteResult = await shippingService.quote(req.user, req.body);
  res
    .status(200)
    .json(new ApiResponse(httpStatus.OK, { quote: quoteResult }, 'Shipping quote calculated'));
});

module.exports = { quote };
