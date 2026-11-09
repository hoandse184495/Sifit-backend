const httpStatus = require('../constants/httpStatus');
const roles = require('../constants/roles');
const AuthSession = require('../models/authSession.model');
const User = require('../models/user.model');
const ApiError = require('../utils/ApiError');
const auditService = require('./adminAudit.service');
const AdminGuard = require('../models/adminGuard.model');
const transaction = require('../utils/withTransaction');
const logger = require('../utils/logger');

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
  // Initialize outside the transaction so the first two requests cannot race
  // to create its collection/document inside competing transactions.
  try {
    await AdminGuard.updateOne(
      { _id: 'active-admins' },
      { $setOnInsert: { revision: 0 } },
      { upsert: true },
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  const user = await transaction(async (session) => {
    await AdminGuard.findOneAndUpdate(
      { _id: 'active-admins' },
      { $inc: { revision: 1 } },
      { session },
    );
    // Authentication may have happened before another admin suspended the actor.
    const actor = await User.findOneAndUpdate(
      { _id: admin._id, role: roles.ADMIN, status: 'ACTIVE' },
      { $inc: { __v: 1 } },
      { new: true, session },
    );
    if (!actor) throw new ApiError(403, 'Tài khoản quản trị không còn hoạt động.');
    if (String(actor._id) === String(id) && status === 'SUSPENDED')
      throw new ApiError(httpStatus.CONFLICT, 'Admins cannot suspend their own account');
    const target = await User.findById(id).session(session);
    if (!target) throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    if (target.role === roles.ADMIN && target.status === 'ACTIVE' && status !== 'ACTIVE') {
      const count = await User.countDocuments({ role: roles.ADMIN, status: 'ACTIVE' }).session(
        session,
      );
      if (count <= 1)
        throw new ApiError(httpStatus.CONFLICT, 'Cannot suspend the last active admin');
    }
    const before = target.toJSON();
    target.status = status;
    await target.save({ session });
    if (status === 'SUSPENDED')
      await AuthSession.updateMany(
        { user: target._id, revokedAt: null },
        { revokedAt: new Date(), revokedReason: reason || 'admin_suspended' },
        { session },
      );
    await auditService.record({
      admin: actor,
      action: `USER_${status}`,
      resourceType: 'USER',
      resourceId: target._id,
      reason,
      before,
      after: target.toJSON(),
      req,
      session,
    });
    return target;
  });
  // Never disconnect a user for an action that later rolls back.
  if (user.status === 'SUSPENDED') {
    try {
      require('../socket').disconnectUser(user._id);
    } catch {
      logger.warn('Could not disconnect suspended sockets; packet authorization remains active');
    }
  }
  return user;
};

module.exports = { getUser, listUsers, updateUserStatus };
