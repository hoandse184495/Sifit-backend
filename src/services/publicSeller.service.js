const User = require('../models/user.model');
const Shop = require('../models/sellerProfile.model');

// Legacy sellers may have no shop profile; a suspended profile is never public.
const visibleSellerIds = async (ids, session = null) => {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  const activeQuery = User.find({ _id: { $in: unique }, role: 'SELLER', status: 'ACTIVE' })
    .distinct('_id')
    .session(session);
  const blockedQuery = Shop.find({ userId: { $in: unique }, status: { $ne: 'ACTIVE' } })
    .distinct('userId')
    .session(session);
  // MongoDB operations sharing a transaction session must run sequentially.
  const [active, blocked] = session
    ? [await activeQuery, await blockedQuery]
    : await Promise.all([activeQuery, blockedQuery]);
  const blockedIds = new Set(blocked.map(String));
  return new Set(active.map(String).filter((id) => !blockedIds.has(id)));
};
const publicSellerStages = () => [
  {
    $lookup: {
      from: User.collection.name,
      localField: 'sellerId',
      foreignField: '_id',
      pipeline: [
        { $match: { role: 'SELLER', status: 'ACTIVE' } },
        { $project: { fullName: 1, avatar: 1 } },
      ],
      as: 'publicSeller',
    },
  },
  { $unwind: '$publicSeller' },
  {
    $lookup: {
      from: Shop.collection.name,
      localField: 'sellerId',
      foreignField: 'userId',
      pipeline: [{ $match: { status: { $ne: 'ACTIVE' } } }, { $project: { _id: 1 } }],
      as: 'blockedShop',
    },
  },
  { $match: { 'blockedShop.0': { $exists: false } } },
  { $unset: 'blockedShop' },
];
module.exports = { visibleSellerIds, publicSellerStages };
