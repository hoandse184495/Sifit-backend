const httpStatus = require('../constants/httpStatus');
const roles = require('../constants/roles');
const { deleteAsset, uploadBuffer } = require('../config/cloudinary');
const Category = require('../models/category.model');
const Product = require('../models/product.model');
const SellerProfile = require('../models/sellerProfile.model');
const User = require('../models/user.model');
const ApiError = require('../utils/ApiError');
const notificationEventService = require('./notificationEvent.service');

const MAX_IMAGES = 8;
const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const getPagination = ({ page = 1, limit = 20 }) => ({
  page: Number(page),
  limit: Number(limit),
});

const getSort = (sort) => {
  const sorts = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    price_asc: { price: 1 },
    price_desc: { price: -1 },
  };

  return { ...(sorts[sort] || sorts.newest), _id: sort === 'oldest' ? 1 : -1 };
};

const toPaginatedResponse = async ({ query, page, limit, sort, populate }) => {
  const [items, total] = await Promise.all([
    Product.find(query)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .populate(populate),
    Product.countDocuments(query),
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildPublicQuery = (filters) => {
  const query = {
    status: 'ACTIVE',
    deletedAt: null,
  };

  if (filters.search) {
    query.$text = { $search: filters.search };
  }

  if (filters.categoryId) query.categoryId = filters.categoryId;
  if (filters.condition) query.condition = filters.condition;
  if (filters.size) query.size = filters.size;
  if (filters.brand) query.brand = new RegExp(`^${escapeRegex(filters.brand)}$`, 'i');
  if (filters.categoryIds?.length) query.categoryId = { $in: filters.categoryIds };
  if (filters.conditions?.length) query.condition = { $in: filters.conditions };
  if (filters.sizes?.length) query.size = { $in: filters.sizes };
  if (filters.brands?.length) query.brand = { $in: filters.brands.map(brand => new RegExp(`^${escapeRegex(brand)}$`, 'i')) };
  if (filters.material) query.description = new RegExp(escapeRegex(filters.material), 'i');

  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    query.price = {};
    if (filters.minPrice !== undefined) query.price.$gte = filters.minPrice;
    if (filters.maxPrice !== undefined) query.price.$lte = filters.maxPrice;
  }

  return query;
};

const ensureActiveCategory = async (categoryId) => {
  const category = await Category.exists({ _id: categoryId, isActive: true });

  if (!category) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Category is invalid or inactive');
  }
};

const ensureOwner = (product, user) => {
  if (!product.sellerId.equals(user._id)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'You do not have permission to access this product');
  }
};

const findEditableProduct = async (id, user) => {
  const product = await Product.findOne({ _id: id, deletedAt: null });

  if (!product) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');
  }

  ensureOwner(product, user);

  if (!['DRAFT', 'REJECTED'].includes(product.status)) {
    throw new ApiError(httpStatus.CONFLICT, 'Only draft or rejected products can be modified');
  }

  return product;
};

const listPublicProducts = async (filters) => {
  const { page, limit } = getPagination(filters);

  return toPaginatedResponse({
    query: buildPublicQuery(filters),
    page,
    limit,
    sort: getSort(filters.sort),
    populate: [
      { path: 'sellerId', select: 'fullName avatar' },
      { path: 'categoryId', select: 'name slug' },
    ],
  });
};

const getPublicProductById = async (id) => {
  const product = await Product.findOne({ _id: id, status: 'ACTIVE', deletedAt: null }).populate({
    path: 'sellerId',
    select: 'fullName avatar',
  });

  if (!product) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');
  }

  return product;
};

const createProduct = async (data, user) => {
  await ensureActiveCategory(data.categoryId);
  const suspendedSeller = await SellerProfile.exists({ userId: user._id, status: 'SUSPENDED' });
  if (suspendedSeller) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Suspended sellers cannot create listings');
  }

  return Product.create({
    title: data.title,
    description: data.description,
    price: data.price,
    categoryId: data.categoryId,
    brand: data.brand,
    size: data.size,
    color: data.color,
    condition: data.condition,
    sellerId: user._id,
    status: 'DRAFT',
    quantity: 1,
  });
};

const listMyProducts = async (user, filters) => {
  const { page, limit } = getPagination(filters);

  return toPaginatedResponse({
    query: { sellerId: user._id, deletedAt: null },
    page,
    limit,
    sort: { createdAt: -1 },
    populate: { path: 'categoryId', select: 'name slug' },
  });
};

const updateProduct = async (id, data, user) => {
  const product = await findEditableProduct(id, user);

  if (data.categoryId) {
    await ensureActiveCategory(data.categoryId);
  }

  ['title', 'description', 'price', 'categoryId', 'brand', 'size', 'color', 'condition'].forEach(
    (field) => {
      if (data[field] !== undefined) {
        product[field] = data[field];
      }
    },
  );

  if (product.status === 'REJECTED') {
    product.status = 'DRAFT';
    product.rejectionReason = undefined;
  }

  return product.save();
};

const softDeleteProduct = async (id, user) => {
  const product = await Product.findOne({ _id: id, deletedAt: null });

  if (!product) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');
  }

  const isOwner = product.sellerId.equals(user._id);
  const isAdmin = user.role === roles.ADMIN;

  if (!isOwner && !isAdmin) {
    throw new ApiError(httpStatus.FORBIDDEN, 'You do not have permission to delete this product');
  }

  if (['RESERVED', 'SOLD'].includes(product.status)) {
    throw new ApiError(httpStatus.CONFLICT, 'Reserved or sold products cannot be deleted');
  }

  product.deletedAt = new Date();
  product.status = product.status === 'ACTIVE' ? 'ARCHIVED' : product.status;
  return product.save();
};

const submitProduct = async (id, user) => {
  const product = await findEditableProduct(id, user);

  if (product.images.length < 1) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'At least one image is required before submission');
  }

  product.status = 'PENDING';
  product.rejectionReason = undefined;
  const saved = await product.save();
  const admins = await User.find({ role: roles.ADMIN, status: 'ACTIVE' }).select('_id');
  await Promise.allSettled(
    admins.map((admin) =>
      notificationEventService.enqueueNotificationEvent({
        eventKey: `product:${saved._id}:submitted:${admin._id}`,
        type: 'NOTIFICATION_CREATE',
        payload: {
          recipientId: admin._id,
          actorId: user._id,
          type: 'PRODUCT_SUBMITTED',
          title: 'Product submitted',
          body: `${user.fullName} submitted a product for approval`,
          resourceType: 'PRODUCT',
          resourceId: saved._id,
          eventKey: `product:${saved._id}:submitted`,
        },
      }),
    ),
  );
  return saved;
};

const detectImageMimeType = (buffer) => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
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

  return null;
};

const validateImageBuffer = (file) => {
  const mimeType = detectImageMimeType(file.buffer);

  if (!mimeType || !ALLOWED_IMAGE_MIME_TYPES.includes(mimeType)) {
    throw new ApiError(415, 'Unsupported image type');
  }
};

const uploadImages = async (id, user, files = []) => {
  if (!files.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'At least one image is required');
  }

  if (files.length > MAX_IMAGES) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A product can have at most 8 images');
  }

  const product = await findEditableProduct(id, user);
  const remainingSlots = MAX_IMAGES - product.images.length;

  if (files.length > remainingSlots) {
    throw new ApiError(httpStatus.CONFLICT, 'Image limit exceeded');
  }

  await Promise.all(files.map(validateImageBuffer));

  const uploaded = [];

  try {
    for (const file of files) {
      const result = await uploadBuffer(file.buffer, {
        folder: 'sifit/products',
        resource_type: 'image',
      });

      uploaded.push({
        url: result.secure_url,
        publicId: result.public_id,
      });
    }

    const updatedProduct = await Product.findOneAndUpdate(
      {
        _id: product._id,
        sellerId: user._id,
        status: { $in: ['DRAFT', 'REJECTED'] },
        deletedAt: null,
        $expr: { $lte: [{ $add: [{ $size: '$images' }, uploaded.length] }, MAX_IMAGES] },
      },
      { $push: { images: { $each: uploaded } } },
      { new: true },
    );

    if (!updatedProduct) {
      throw new ApiError(httpStatus.CONFLICT, 'Image limit exceeded');
    }

    return updatedProduct;
  } catch (error) {
    await Promise.allSettled(uploaded.map((image) => deleteAsset(image.publicId)));
    throw error;
  }
};

const deleteImage = async (id, encodedPublicId, user) => {
  const publicId = decodeURIComponent(encodedPublicId);

  if (!publicId.startsWith('sifit/products/')) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid image identifier');
  }

  const product = await findEditableProduct(id, user);
  const imageExists = product.images.some((image) => image.publicId === publicId);

  if (!imageExists) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Image not found');
  }

  product.images = product.images.filter((image) => image.publicId !== publicId);
  await product.save();

  try {
    await deleteAsset(publicId);
  } catch (_error) {
    // DB reference is already removed; a later reconciliation job can retry this Cloudinary publicId.
  }

  return product;
};

module.exports = {
  createProduct,
  deleteImage,
  getPublicProductById,
  listMyProducts,
  listPublicProducts,
  softDeleteProduct,
  submitProduct,
  updateProduct,
  uploadImages,
};
