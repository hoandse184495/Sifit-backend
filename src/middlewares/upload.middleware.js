const multer = require('multer');

const uploadProductImages = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 8,
  },
});

module.exports = {
  uploadProductImages,
};
