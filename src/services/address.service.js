const mongoose = require('mongoose');
const httpStatus = require('../constants/httpStatus');
const Address = require('../models/address.model');
const ApiError = require('../utils/ApiError');
const roles = require('../constants/roles');

const addressTypeForUser = (user) =>
  user.role === roles.BUYER ? 'SHIPPING' : user.role === roles.SELLER ? 'PICKUP' : 'BOTH';

const listAddresses = (user) =>
  Address.find({ userId: user._id, isActive: true }).sort({ isDefault: -1, createdAt: -1 });

const setDefaultIfNeeded = async (address, session) => {
  if (!address.isDefault) return;
  await Address.updateMany(
    {
      userId: address.userId,
      _id: { $ne: address._id },
      addressType: { $in: [address.addressType, 'BOTH'] },
    },
    { isDefault: false },
    { session },
  );
};

const createAddress = async (user, data) => {
  const session = await mongoose.startSession();
  try {
    let address;
    await session.withTransaction(async () => {
      const docs = await Address.create(
        [{ ...data, userId: user._id, addressType: addressTypeForUser(user) }],
        { session },
      );
      address = docs[0];
      await setDefaultIfNeeded(address, session);
    });
    return address;
  } finally {
    await session.endSession();
  }
};

const getOwnedAddress = async (user, id) => {
  const address = await Address.findOne({ _id: id, userId: user._id, isActive: true });
  if (!address) throw new ApiError(httpStatus.NOT_FOUND, 'Address not found');
  return address;
};

const updateAddress = async (user, id, data) => {
  const address = await getOwnedAddress(user, id);
  Object.assign(address, data, { addressType: addressTypeForUser(user) });
  await address.save();
  if (address.isDefault) await setDefaultIfNeeded(address);
  return address;
};

const deleteAddress = async (user, id) => {
  const address = await getOwnedAddress(user, id);
  address.isActive = false;
  address.isDefault = false;
  await address.save();
  return address;
};

const setDefaultAddress = async (user, id) => {
  const address = await getOwnedAddress(user, id);
  address.isDefault = true;
  await address.save();
  await setDefaultIfNeeded(address);
  return address;
};

module.exports = {
  createAddress,
  deleteAddress,
  getOwnedAddress,
  listAddresses,
  setDefaultAddress,
  updateAddress,
};
