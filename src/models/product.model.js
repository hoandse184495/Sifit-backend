const mongoose = require('mongoose');

const productConditions = ['NEW_WITH_TAGS', 'LIKE_NEW', 'GOOD', 'FAIR'];
const productStatuses = ['DRAFT', 'PENDING', 'ACTIVE', 'REJECTED', 'RESERVED', 'SOLD', 'ARCHIVED'];
const productSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'FREE_SIZE'];

const imageSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
      trim: true,
    },
    publicId: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { _id: false },
);

const productSchema = new mongoose.Schema(
  {
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 5,
      maxlength: 150,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },
    price: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: 'Price must be an integer VND amount',
      },
      index: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
      index: true,
    },
    brand: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    size: {
      type: String,
      required: true,
      enum: productSizes,
    },
    color: {
      type: String,
      trim: true,
    },
    condition: {
      type: String,
      required: true,
      enum: productConditions,
    },
    images: {
      type: [imageSchema],
      validate: {
        validator(images) {
          return images.length <= 8;
        },
        message: 'A product can have at most 8 images',
      },
      default: [],
    },
    status: {
      type: String,
      enum: productStatuses,
      default: 'DRAFT',
      index: true,
    },
    quantity: {
      type: Number,
      default: 1,
      immutable: true,
    },
    rejectionReason: {
      type: String,
      trim: true,
    },
    approvedAt: {
      type: Date,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    hiddenAt: {
      type: Date,
    },
    hiddenBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    deletedAt: {
      type: Date,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

productSchema.index({ createdAt: -1 });
productSchema.index({ title: 'text', description: 'text' });

module.exports = mongoose.model('Product', productSchema);
module.exports.productConditions = productConditions;
module.exports.productStatuses = productStatuses;
module.exports.productSizes = productSizes;
