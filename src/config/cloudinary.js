const crypto = require('node:crypto');
const { v2: cloudinary } = require('cloudinary');
const env = require('./env');

const isCloudinaryConfigured = () =>
  Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);

if (isCloudinaryConfigured()) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

const detectMimeType = (buffer) => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return 'image/jpeg';
};

const uploadBuffer = async (buffer, options = {}) => {
  if (!isCloudinaryConfigured()) {
    const folder = options.folder || 'sifit/uploads';
    const publicId = `${folder}/local_${crypto.randomUUID()}`;
    const mimeType = detectMimeType(buffer);
    return {
      secure_url: `data:${mimeType};base64,${buffer.toString('base64')}`,
      public_id: publicId,
    };
  }

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
  if (!isCloudinaryConfigured()) {
    return { result: 'ok', public_id: publicId };
  }
  return cloudinary.uploader.destroy(publicId, { invalidate: true });
};

module.exports = {
  deleteAsset,
  uploadBuffer,
};
