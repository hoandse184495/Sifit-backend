const User = require('../models/user.model');
const cloudinary = require('../config/cloudinary');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { safeUser } = require('./auth.service');

const removeAsset = async (publicId) => {
  if (!publicId) return;
  try { await cloudinary.deleteAsset(publicId); }
  catch (_error) { logger.warn('Avatar asset cleanup failed; the profile was saved successfully'); }
};

const updateProfile = async (userId, data) => {
  const changes = {};
  if (data.fullName !== undefined) changes.fullName = data.fullName;
  if (data.phone !== undefined) changes.phone = data.phone;
  const user = await User.findOneAndUpdate({ _id: userId, status: 'ACTIVE' }, { $set: changes }, { new: true, runValidators: true });
  if (!user) throw new ApiError(403, 'Account is unavailable');
  return safeUser(user);
};

const validateAvatar = (file) => {
  if (!file?.buffer?.length) throw new ApiError(400, 'Please choose an avatar image');
  const buffer = file.buffer;
  const jpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const png = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  if (!jpeg && !png && !webp) throw new ApiError(415, 'Avatar must be a JPEG, PNG or WebP image');
};

const uploadAvatar = async (userId, file) => {
  validateAvatar(file);
  let asset;
  let previous;
  try {
    asset = await cloudinary.uploadBuffer(file.buffer, {
      folder: `sifit/avatars/${userId}`,
      resource_type: 'image',
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
      transformation: [{ width: 320, height: 320, crop: 'fill', gravity: 'auto' }, { quality: 'auto', fetch_format: 'auto' }],
    });
    if (!asset.secure_url || !asset.public_id) throw new ApiError(502, 'Avatar upload did not complete');
    // Return the previous reference atomically so overlapping uploads clean up the correct old asset.
    previous = await User.findOneAndUpdate(
      { _id: userId, status: 'ACTIVE' },
      { $set: { avatar: asset.secure_url, avatarPublicId: asset.public_id } },
      { new: false, runValidators: true, projection: { avatarPublicId: 1 } },
    );
    if (!previous) throw new ApiError(403, 'Account is unavailable');
  } catch (error) {
    await removeAsset(asset?.public_id);
    throw error;
  }
  if (previous.avatarPublicId !== asset.public_id) await removeAsset(previous.avatarPublicId);
  const user = await User.findById(userId);
  return safeUser(user);
};

const deleteAvatar = async (userId) => {
  const previous = await User.findOneAndUpdate(
    { _id: userId, status: 'ACTIVE' },
    { $unset: { avatar: 1, avatarPublicId: 1 } },
    { new: false, projection: { avatarPublicId: 1 } },
  );
  if (!previous) throw new ApiError(403, 'Account is unavailable');
  await removeAsset(previous.avatarPublicId);
  const user = await User.findById(userId);
  return safeUser(user);
};

module.exports = { updateProfile, uploadAvatar, deleteAvatar };
