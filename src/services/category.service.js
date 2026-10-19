const httpStatus = require('../constants/httpStatus');
const Category = require('../models/category.model');
const Product = require('../models/product.model');
const ApiError = require('../utils/ApiError');
const slugify = require('../utils/slugify');

const listActiveCategories = async () => Category.find({ isActive: true }).sort({ name: 1 });

const ensureUniqueCategory = async ({ name, slug, excludeId }) => {
  const query = {
    $or: [{ name }, { slug }],
  };

  if (excludeId) {
    query._id = { $ne: excludeId };
  }

  const existing = await Category.exists(query);

  if (existing) {
    throw new ApiError(httpStatus.CONFLICT, 'Category name or slug already exists');
  }
};

const createCategory = async (data) => {
  const normalizedData = {
    ...data,
    slug: data.slug ? slugify(data.slug) : slugify(data.name),
  };
  await ensureUniqueCategory(normalizedData);

  return Category.create(normalizedData);
};

const updateCategory = async (id, data) => {
  const current = await Category.findById(id);

  if (!current) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Category not found');
  }

  const normalizedData = { ...data };

  if (data.name && !data.slug) {
    normalizedData.slug = slugify(data.name);
  } else if (data.slug) {
    normalizedData.slug = slugify(data.slug);
  }

  await ensureUniqueCategory({
    name: normalizedData.name || current.name,
    slug: normalizedData.slug || current.slug,
    excludeId: id,
  });

  if (normalizedData.isActive === false) {
    const referenced = await Product.exists({ categoryId: id, deletedAt: null });

    if (referenced) {
      throw new ApiError(httpStatus.CONFLICT, 'Cannot disable a category referenced by products');
    }
  }

  Object.assign(current, normalizedData);
  return current.save();
};

module.exports = {
  createCategory,
  listActiveCategories,
  updateCategory,
};
