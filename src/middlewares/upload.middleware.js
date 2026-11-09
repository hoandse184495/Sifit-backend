const multer = require('multer');

const uploadProductImages = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 8,
  },
});

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
}).single('avatar');
const ApiError = require('../utils/ApiError');
const uploadAvatar = (req, res, next) => avatarUpload(req, res, (error) => {
  if (error instanceof multer.MulterError) {
    return next(new ApiError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
      error.code === 'LIMIT_FILE_SIZE' ? 'Avatar must be no larger than 5 MB' : 'Choose exactly one image using the avatar field'));
  }
  return next(error);
});

module.exports = {
  uploadProductImages,
  uploadAvatar,
};
