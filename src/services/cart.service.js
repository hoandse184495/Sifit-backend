const httpStatus = require('../constants/httpStatus');
const Cart = require('../models/cart.model');
const Product = require('../models/product.model');
const ApiError = require('../utils/ApiError');

const MAX_CART_ITEMS = 30;

const getOrCreateCart = async (userId, session) => {
  let cart = await Cart.findOne({ userId }).session(session || null);

  if (!cart) {
    cart = await Cart.create([{ userId, items: [] }], { session });
    return cart[0];
  }

  return cart;
};

const formatCart = async (cart) => {
  await cart.populate({
    path: 'items.productId',
    select: 'title price status images sellerId deletedAt',
    populate: { path: 'sellerId', select: 'fullName avatar status' },
  });

  let estimatedSubtotal = 0;
  const items = cart.items.map((item) => {
    const product = item.productId;
    const unavailable =
      !product ||
      product.deletedAt ||
      product.status !== 'ACTIVE' ||
      !product.sellerId ||
      product.sellerId.status !== 'ACTIVE';

    if (!unavailable) {
      estimatedSubtotal += product.price;
    }

    return {
      product: product
        ? {
            id: product.id,
            title: product.title,
            image: product.images[0]?.url,
            price: product.price,
            status: product.status,
            seller: product.sellerId
              ? {
                  id: product.sellerId.id,
                  fullName: product.sellerId.fullName,
                  avatar: product.sellerId.avatar,
                }
              : null,
          }
        : null,
      addedAt: item.addedAt,
      available: !unavailable,
      unavailableReason: unavailable ? 'Product is no longer available for checkout' : undefined,
    };
  });

  return {
    id: cart.id,
    items,
    estimatedSubtotal,
  };
};

const getCart = async (user) => {
  const cart = await getOrCreateCart(user._id);
  return formatCart(cart);
};

const addItem = async (user, productId) => {
  const product = await Product.findOne({
    _id: productId,
    status: 'ACTIVE',
    deletedAt: null,
  }).populate({
    path: 'sellerId',
    select: 'status',
  });

  if (!product) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Product is not available');
  }

  if (product.sellerId._id.equals(user._id)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'You cannot add your own product to cart');
  }

  if (product.sellerId.status !== 'ACTIVE') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Product is not available');
  }

  const cart = await getOrCreateCart(user._id);

  if (cart.items.length >= MAX_CART_ITEMS) {
    throw new ApiError(httpStatus.CONFLICT, 'Cart item limit reached');
  }

  const updated = await Cart.findOneAndUpdate(
    {
      userId: user._id,
      'items.productId': { $ne: product._id },
      $expr: { $lt: [{ $size: '$items' }, MAX_CART_ITEMS] },
    },
    {
      $push: {
        items: {
          productId: product._id,
          addedAt: new Date(),
        },
      },
    },
    { new: true },
  );

  if (!updated) {
    throw new ApiError(httpStatus.CONFLICT, 'Product is already in cart or cart is full');
  }

  return formatCart(updated);
};

const removeItem = async (user, productId) => {
  const cart = await getOrCreateCart(user._id);
  cart.items = cart.items.filter((item) => String(item.productId) !== String(productId));
  await cart.save();

  return formatCart(cart);
};

const clearCart = async (user) => {
  const cart = await getOrCreateCart(user._id);
  cart.items = [];
  await cart.save();

  return formatCart(cart);
};

module.exports = {
  addItem,
  clearCart,
  formatCart,
  getCart,
  getOrCreateCart,
  removeItem,
};
