const httpStatus = require('../constants/httpStatus');
const roles = require('../constants/roles');
const AuthSession = require('../models/authSession.model');
const User = require('../models/user.model');
const ApiError = require('../utils/ApiError');
const auditService = require('./adminAudit.service');

const buildUserQuery = ({ search, role, status }) => {
  const query = {};
  if (role) query.role = role;
  if (status) query.status = status;
  if (search) {
    const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ fullName: pattern }, { email: pattern }];
  }
  return query;
};

const listUsers = async ({ page = 1, limit = 20, sort = 'newest', ...filters }) => {
  const query = buildUserQuery(filters);
  const [items, total] = await Promise.all([
    User.find(query)
      .sort({ createdAt: sort === 'oldest' ? 1 : -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(query),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const getUser = async (id) => {
  const user = await User.findById(id);
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  return user;
};

const updateUserStatus = async ({ admin, id, status, reason, req }) => {
  if (String(admin._id) === String(id) && status === 'SUSPENDED') {
    throw new ApiError(httpStatus.CONFLICT, 'Admins cannot suspend their own account');
  }

  const user = await User.findById(id);
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, 'User not found');

  if (user.role === roles.ADMIN && user.status === 'ACTIVE' && status !== 'ACTIVE') {
    const activeAdmins = await User.countDocuments({ role: roles.ADMIN, status: 'ACTIVE' });
    if (activeAdmins <= 1)
      throw new ApiError(httpStatus.CONFLICT, 'Cannot suspend the last active admin');
  }

  const before = user.toJSON();
  user.status = status;
  await user.save();

  if (status === 'SUSPENDED') {
    await AuthSession.updateMany(
      { user: user._id, revokedAt: null },
      { revokedAt: new Date(), revokedReason: reason || 'admin_suspended' },
    );
  }

  await auditService.record({
    admin,
    action: `USER_${status}`,
    resourceType: 'USER',
    resourceId: user._id,
    reason,
    before,
    after: user.toJSON(),
    req,
  });

  return user;
};

module.exports = { getUser, listUsers, updateUserStatus };
