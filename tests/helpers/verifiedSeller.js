// Trusted historical manual-review fixture; production code never calls this helper.
const Profile = require('../../src/models/sellerProfile.model');
const Verification = require('../../src/models/sellerVerification.model');
const Bank = require('../../src/models/sellerBankAccount.model');
const policy = require('../../src/services/sellerVerificationPolicy.service');
module.exports = async (sellerId) => {
  const profile = await Profile.findOne({ userId: sellerId });
  const bank = await Bank.findOne({ sellerId });
  if (!profile || !bank) throw new Error('Verified fixture requires profile and bank');
  const record = await Verification.create({
    sellerId: profile._id,
    ownerId: sellerId,
    verificationStatus: 'VERIFIED',
    verificationMethod: 'MANUAL_REVIEW',
    bankSnapshot: policy.bankSnapshot(bank),
    bankFingerprint: policy.bankFingerprint(bank),
    legalName: bank.accountName,
    consentAt: new Date(),
    reviewedAt: new Date(),
  });
  await Profile.updateOne(
    { _id: profile._id },
    { verificationStatus: 'VERIFIED', verificationId: record._id },
  );
  return record;
};
