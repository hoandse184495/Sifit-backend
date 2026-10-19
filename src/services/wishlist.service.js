const httpStatus = require('../constants/httpStatus');
const Product = require('../models/product.model');
const Wishlist = require('../models/wishlist.model');
const ApiError = require('../utils/ApiError');

const MAX_WISHLIST_ITEMS = 100;

const getOrCreateWishlist = async (user) => {
  let wishlist = await Wishlist.findOne({ userId: user._id });
  if (!wishlist) {
    const docs = await Wishlist.create([{ userId: user._id, items: [] }]);
    wishlist = docs[0];
  }
  return wishlist;
};

const availability = (product) => {
  if (
    !product ||
    product.deletedAt ||
    ['DRAFT', 'PENDING', 'REJECTED', 'ARCHIVED'].includes(product.status)
  )
    return 'UNAVAILABLE';
  if (product.status === 'RESERVED') return 'RESERVED';
  if (product.status === 'SOLD') return 'SOLD';
  return 'AVAILABLE';
};

const formatWishlist = async (wishlist) => {
  await wishlist.populate({
    path: 'items.productId',
    select: 'title price images brand size condition status sellerId deletedAt',
    populate: { path: 'sellerId', select: 'fullName avatar' },
  });
  return {
    id: wishlist.id,
    items: wishlist.items.map((item) => {
      const product = item.productId;
      const currentAvailability = availability(product);
      if (currentAvailability === 'UNAVAILABLE') {
        return {
          productId: product?.id || item.productId,
          availability: currentAvailability,
          addedAt: item.addedAt,
        };
      }
      return {
        productId: product?.id || item.productId,
        title: product?.title,
        price: product?.price,
        primaryImage: product?.images?.[0]?.url,
        brand: product?.brand,
        size: product?.size,
        condition: product?.condition,
        seller: product?.sellerId
          ? {
              id: product.sellerId.id,
              fullName: product.sellerId.fullName,
              avatar: product.sellerId.avatar,
            }
          : null,
        availability: currentAvailability,
        addedAt: item.addedAt,
      };
    }),
  };
};

const getWishlist = async (user) => formatWishlist(await getOrCreateWishlist(user));

const addItem = async (user, productId) => {
  const product = await Product.findOne({ _id: productId, status: 'ACTIVE', deletedAt: null });
  if (!product) throw new ApiError(httpStatus.BAD_REQUEST, 'Product is not available');
  if (product.sellerId.equals(user._id))
    throw new ApiError(httpStatus.FORBIDDEN, 'You cannot wishlist your own product');
  await getOrCreateWishlist(user);
  const updated = await Wishlist.findOneAndUpdate(
    {
      userId: user._id,
      'items.productId': { $ne: product._id },
      $expr: { $lt: [{ $size: '$items' }, MAX_WISHLIST_ITEMS] },
    },
    { $push: { items: { productId: product._id, addedAt: new Date() } } },
    { new: true },
  );
  if (!updated)
    throw new ApiError(httpStatus.CONFLICT, 'Product is already wishlisted or wishlist is full');
  return formatWishlist(updated);
};

const removeItem = async (user, productId) => {
  const wishlist = await getOrCreateWishlist(user);
  wishlist.items = wishlist.items.filter((item) => String(item.productId) !== String(productId));
  await wishlist.save();
  return formatWishlist(wishlist);
};

const clearWishlist = async (user) => {
  const wishlist = await getOrCreateWishlist(user);
  wishlist.items = [];
  await wishlist.save();
  return formatWishlist(wishlist);
};

const checkItem = async (user, productId) => {
  const wishlist = await getOrCreateWishlist(user);
  return {
    isWishlisted: wishlist.items.some((item) => String(item.productId) === String(productId)),
  };
};

module.exports = { addItem, checkItem, clearWishlist, getWishlist, removeItem };
