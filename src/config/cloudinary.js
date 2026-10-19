const { v2: cloudinary } = require('cloudinary');
const env = require('./env');
const ApiError = require('../utils/ApiError');

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

const ensureCloudinaryConfigured = () => {
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    throw new ApiError(500, 'Cloudinary is not configured');
  }
};

const uploadBuffer = async (buffer, options) => {
  ensureCloudinaryConfigured();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(result);
    });

    stream.end(buffer);
  });
};

const deleteAsset = async (publicId) => {
  ensureCloudinaryConfigured();
  return cloudinary.uploader.destroy(publicId, { invalidate: true });
};

module.exports = {
  deleteAsset,
  uploadBuffer,
};
