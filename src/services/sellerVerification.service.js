const httpStatus = require('../constants/httpStatus');
const SellerProfile = require('../models/sellerProfile.model');
const SellerVerification = require('../models/sellerVerification.model');
const ApiError = require('../utils/ApiError');

const submitVerification = async (user) => {
  const profile = await SellerProfile.findOne({ userId: user._id });
  if (!profile) throw new ApiError(httpStatus.BAD_REQUEST, 'Create a seller profile first');
  if (profile.verificationStatus === 'VERIFIED') {
    throw new ApiError(httpStatus.CONFLICT, 'Seller profile is already verified');
  }
  const verification = await SellerVerification.create({
    sellerId: profile._id,
    verificationStatus: 'PENDING',
    verificationMethod: 'SIMULATED_REVIEW',
    providerReference: `sim_kyc_${profile._id}`,
  });
  profile.verificationStatus = 'PENDING';
  await profile.save();
  return verification;
};

const getStatus = async (user) => {
  const profile = await SellerProfile.findOne({ userId: user._id });
  if (!profile) throw new ApiError(httpStatus.NOT_FOUND, 'Seller profile not found');
  const latest = await SellerVerification.findOne({ sellerId: profile._id }).sort({
    createdAt: -1,
  });
  return { verificationStatus: profile.verificationStatus, latest };
};

const listPending = async ({ page = 1, limit = 20 } = {}) => {
  const query = { verificationStatus: 'PENDING' };
  const [items, total] = await Promise.all([
    SellerVerification.find(query)
      .sort({ createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('sellerId'),
    SellerVerification.countDocuments(query),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const review = async ({ id, admin, status, reason }) => {
  const verification = await SellerVerification.findById(id);
  if (!verification) throw new ApiError(httpStatus.NOT_FOUND, 'Seller verification not found');
  if (verification.verificationStatus !== 'PENDING') {
    throw new ApiError(httpStatus.CONFLICT, 'Only pending verifications can be reviewed');
  }
  verification.verificationStatus = status;
  verification.reviewedAt = new Date();
  verification.reviewedBy = admin._id;
  verification.rejectionReason = reason;
  await verification.save();
  await SellerProfile.updateOne({ _id: verification.sellerId }, { verificationStatus: status });
  return verification;
};

module.exports = { getStatus, listPending, review, submitVerification };
