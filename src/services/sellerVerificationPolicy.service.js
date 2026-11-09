const crypto = require('node:crypto');
const Profile = require('../models/sellerProfile.model');
const Verification = require('../models/sellerVerification.model');
const Bank = require('../models/sellerBankAccount.model');
const ApiError = require('../utils/ApiError');
const normalizeName = (name) =>
  String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
const bankFingerprint = (bank) =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify([
        bank.bankBin,
        String(bank.accountNumber).toUpperCase(),
        normalizeName(bank.accountName),
      ]),
    )
    .digest('hex');
const bankSnapshot = (bank) =>
  Object.fromEntries(
    ['bankName', 'bankBin', 'accountNumber', 'accountName'].map((key) => [key, bank[key]]),
  );
const assertVerified = async (sellerId, session = null, approvedBank = null) => {
  const profile = await Profile.findOne({
    userId: sellerId,
    status: 'ACTIVE',
    verificationStatus: 'VERIFIED',
  })
    .select('+verificationId')
    .session(session);
  const verification =
    profile?.verificationId &&
    (await Verification.findOne({
      _id: profile.verificationId,
      sellerId: profile._id,
      ownerId: sellerId,
      verificationStatus: 'VERIFIED',
      verificationMethod: 'MANUAL_REVIEW',
    }).session(session));
  const bank = approvedBank || (await Bank.findOne({ sellerId }).session(session));
  if (!verification || !bank || verification.bankFingerprint !== bankFingerprint(bank))
    throw new ApiError(
      409,
      'Shop cần hồ sơ xác minh thủ công đã duyệt khớp tài khoản nhận tiền. Vui lòng cập nhật hồ sơ shop.',
    );
  return verification;
};
const assertSnapshot = async (sellerId, id, bank, session = null) => {
  const record =
    id &&
    (await Verification.findOne({
      _id: id,
      ownerId: sellerId,
      verificationStatus: 'VERIFIED',
      verificationMethod: 'MANUAL_REVIEW',
    }).session(session));
  if (!record || !bank?.accountNumber || record.bankFingerprint !== bankFingerprint(bank))
    throw new ApiError(
      409,
      'Khoản chi chưa gắn hồ sơ và tài khoản đã xác minh. Cần kiểm tra lại trước khi chuyển tiền.',
    );
  return record;
};
module.exports = { normalizeName, bankFingerprint, bankSnapshot, assertVerified, assertSnapshot };
