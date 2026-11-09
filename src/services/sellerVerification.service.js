const crypto = require('node:crypto');
const Profile = require('../models/sellerProfile.model');
const Verification = require('../models/sellerVerification.model');
const Document = require('../models/sellerVerificationDocument.model');
const Bank = require('../models/sellerBankAccount.model');
const User = require('../models/user.model');
const ApiError = require('../utils/ApiError');
const transaction = require('../utils/withTransaction');
const policy = require('./sellerVerificationPolicy.service');
const events = require('./notificationEvent.service');
const audit = require('./adminAudit.service');
const history = (record, user, action, note) => {
  record.contentVersion = (record.contentVersion || 0) + 1;
  record.history.push({ action, actorId: user._id, note });
};
// Bank edits, submission, review and payout approval serialize on the owner.
const lockOwner = (id, session) =>
  User.findOneAndUpdate(
    { _id: id, status: 'ACTIVE' },
    { $inc: { __v: 1 } },
    { new: true, session },
  );
const getCase = async (user, id, session = null) => {
  const record = await Verification.findById(id).session(session);
  if (!record) throw new ApiError(404, 'Không tìm thấy hồ sơ xác minh.');
  const profile = await Profile.findById(record.sellerId)
    .select('+verificationId')
    .session(session);
  if (!profile || (user.role !== 'ADMIN' && String(profile.userId) !== String(user._id)))
    throw new ApiError(404, 'Không tìm thấy hồ sơ xác minh của bạn.');
  return { record, profile };
};
const detail = async (user, id) => {
  const { record, profile } = await getCase(user, id);
  const documents = await Document.find({ verificationId: id }).select('-sha256');
  const bank = await Bank.findOne({ sellerId: profile.userId });
  return {
    verification: record,
    shop: {
      _id: profile._id,
      shopName: profile.shopName,
      verificationStatus: profile.verificationStatus,
    },
    documents,
    bankMatches: Boolean(bank && record.bankFingerprint === policy.bankFingerprint(bank)),
  };
};
const notify = async (record, user, session, action) => {
  const recipients =
    action === 'SUBMITTED'
      ? (await User.find({ role: 'ADMIN', status: 'ACTIVE' }).select('_id').session(session)).map(
          (item) => item._id,
        )
      : [record.ownerId];
  for (const recipientId of recipients)
    await events.enqueueNotificationEvent(
      {
        eventKey: `verification:${record._id}:${record.contentVersion}:${recipientId}`,
        type: 'NOTIFICATION_CREATE',
        payload: {
          recipientId,
          actorId: action === 'BANK_CHANGED' ? undefined : user._id,
          type: 'SELLER_VERIFICATION_UPDATED',
          title:
            action === 'SUBMITTED'
              ? 'Có hồ sơ shop cần xác minh'
              : action === 'VERIFIED'
                ? 'Hồ sơ shop đã được xác minh'
                : action === 'BANK_CHANGED'
                  ? 'Cần xác minh lại tài khoản nhận tiền'
                  : 'Hồ sơ shop cần bổ sung',
          body:
            action === 'SUBMITTED'
              ? 'Người bán đã gửi hồ sơ và ảnh riêng tư. Mở chi tiết để kiểm tra.'
              : action === 'VERIFIED'
                ? 'Admin đã kiểm tra và duyệt hồ sơ. Chi trả còn phụ thuộc điều kiện của từng đơn.'
                : action === 'BANK_CHANGED'
                  ? 'Tài khoản nhận tiền đã thay đổi. Vui lòng gửi hồ sơ mới trước khi duyệt khoản chi tiếp theo.'
                  : record.rejectionReason.slice(0, 500),
          resourceType: 'VERIFICATION',
          resourceId: record._id,
          eventKey: `verification:${record._id}:${record.contentVersion}:${recipientId}`,
        },
      },
      { session },
    );
};
const createDraft = (user, body) =>
  transaction(async (session) => {
    if (!(await lockOwner(user._id, session)))
      throw new ApiError(403, 'Tài khoản không hoạt động.');
    const profile = await Profile.findOne({ userId: user._id, status: 'ACTIVE' }).session(session);
    if (!profile) throw new ApiError(409, 'Cần tạo shop đang hoạt động trước.');
    if (
      await Verification.exists({
        ownerId: user._id,
        verificationStatus: { $in: ['DRAFT', 'PENDING'] },
      }).session(session)
    )
      throw new ApiError(409, 'Bạn đã có hồ sơ nháp hoặc đang chờ duyệt. Hãy mở hồ sơ hiện có.');
    let verified = false;
    try {
      await policy.assertVerified(user._id, session);
      verified = true;
    } catch (error) {
      if (error.statusCode !== 409) throw error;
    }
    if (verified) throw new ApiError(409, 'Shop đã được xác minh với tài khoản hiện tại.');
    const bank = await Bank.findOne({ sellerId: user._id }).session(session);
    if (!bank)
      throw new ApiError(409, 'Hãy lưu tài khoản ngân hàng nhận tiền trước khi lập hồ sơ.');
    if (policy.normalizeName(bank.accountName) !== policy.normalizeName(body.legalName))
      throw new ApiError(400, 'Tên chủ shop cần khớp tên chủ tài khoản nhận tiền.');
    const [record] = await Verification.create(
      [
        {
          ...body,
          sellerId: profile._id,
          ownerId: user._id,
          verificationStatus: 'DRAFT',
          verificationMethod: 'MANUAL_REVIEW',
          bankSnapshot: policy.bankSnapshot(bank),
          bankFingerprint: policy.bankFingerprint(bank),
          history: [{ action: 'DRAFT_CREATED', actorId: user._id }],
          submittedAt: null,
        },
      ],
      { session },
    );
    return record;
  });
const lockDraft = async (user, id, session) => {
  const { record } = await getCase(user, id, session);
  if (String(record.ownerId) !== String(user._id) || record.verificationStatus !== 'DRAFT')
    throw new ApiError(409, 'Chỉ chủ shop được sửa hồ sơ nháp.');
  if (!(await lockOwner(user._id, session))) throw new ApiError(403, 'Tài khoản không hoạt động.');
  return record;
};
const updateDraft = (user, id, body) =>
  transaction(async (session) => {
    const record = await lockDraft(user, id, session);
    if (record.contentVersion !== body.expectedVersion)
      throw new ApiError(409, 'Hồ sơ đã thay đổi. Hãy tải lại.');
    const bank = await Bank.findOne({ sellerId: user._id }).session(session);
    if (!bank || policy.normalizeName(body.legalName) !== policy.normalizeName(bank.accountName))
      throw new ApiError(409, 'Cần tài khoản ngân hàng khớp tên chủ shop.');
    for (const key of ['legalName', 'phone', 'contactAddress']) record[key] = body[key];
    if (record.bankFingerprint !== policy.bankFingerprint(bank))
      await Document.deleteMany({ verificationId: id, kind: 'BANK_OWNERSHIP' }).session(session);
    record.bankSnapshot = policy.bankSnapshot(bank);
    record.bankFingerprint = policy.bankFingerprint(bank);
    history(record, user, 'DRAFT_UPDATED');
    await record.save({ session });
    return record;
  });
const detectImage = (buffer) => {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
    return 'image/jpeg';
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  throw new ApiError(400, 'Chỉ nhận ảnh JPEG, PNG hoặc WebP có định dạng hợp lệ.');
};
const uploadDocument = async (user, id, kind, file) => {
  if (!file || file.size > 5 * 1024 * 1024) throw new ApiError(400, 'Chọn một ảnh tối đa 5 MB.');
  const mimeType = detectImage(file.buffer);
  const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
  return transaction(async (session) => {
    const record = await lockDraft(user, id, session);
    const document = await Document.findOneAndUpdate(
      { verificationId: id, kind },
      { $set: { data: file.buffer, mimeType, size: file.buffer.length, sha256 } },
      { new: true, upsert: true, runValidators: true, session },
    );
    history(record, user, 'DOCUMENT_UPLOADED', kind);
    await record.save({ session });
    return { _id: document._id, kind, mimeType, size: document.size };
  });
};
const removeDocument = (user, id, kind) =>
  transaction(async (session) => {
    const record = await lockDraft(user, id, session);
    await Document.deleteOne({ verificationId: id, kind }).session(session);
    history(record, user, 'DOCUMENT_REMOVED', kind);
    await record.save({ session });
    return record;
  });
const documentFile = async (user, id, kind) => {
  await getCase(user, id);
  const file = await Document.findOne({ verificationId: id, kind }).select('+data');
  if (!file) throw new ApiError(404, 'Không tìm thấy ảnh xác minh.');
  return file;
};
const submitVerification = (user, body) =>
  transaction(async (session) => {
    const record = await lockDraft(user, body.verificationId, session);
    const profile = await Profile.findOne({ _id: record.sellerId, status: 'ACTIVE' })
      .select('+verificationVersion')
      .session(session);
    if (!profile) throw new ApiError(409, 'Shop đang bị tạm ngưng.');
    if (record.contentVersion !== body.expectedVersion)
      throw new ApiError(409, 'Hồ sơ đã thay đổi. Hãy tải lại trước khi gửi.');
    const bank = await Bank.findOne({ sellerId: user._id }).session(session);
    if (!bank || record.bankFingerprint !== policy.bankFingerprint(bank))
      throw new ApiError(
        409,
        'Tài khoản nhận tiền đã thay đổi. Hãy lưu lại hồ sơ nháp và tải ảnh ngân hàng mới.',
      );
    if ((await Document.countDocuments({ verificationId: record._id }).session(session)) !== 2)
      throw new ApiError(409, 'Cần ảnh xác minh chủ shop và ảnh sở hữu tài khoản ngân hàng.');
    record.verificationStatus = 'PENDING';
    record.submittedAt = new Date();
    record.consentAt = new Date();
    history(record, user, 'SUBMITTED');
    await record.save({ session });
    profile.verificationStatus = 'PENDING';
    profile.verificationId = record._id;
    profile.verificationVersion = (profile.verificationVersion || 0) + 1;
    await profile.save({ session });
    await notify(record, user, session, 'SUBMITTED');
    return record;
  });
const getStatus = async (user) => {
  const profile = await Profile.findOne({ userId: user._id });
  if (!profile) throw new ApiError(404, 'Chưa có hồ sơ shop.');
  const latest = await Verification.findOne({ sellerId: profile._id }).sort({
    createdAt: -1,
    _id: -1,
  });
  let payoutVerified = false;
  try {
    await policy.assertVerified(user._id);
    payoutVerified = true;
  } catch (error) {
    if (error.statusCode !== 409) throw error;
  }
  return { verificationStatus: profile.verificationStatus, latest, payoutVerified };
};
const listPending = async ({ page = 1, limit = 20, status = 'PENDING' } = {}) => {
  const query = { verificationStatus: status };
  const [items, total] = await Promise.all([
    Verification.find(query)
      .select(
        'sellerId ownerId verificationStatus verificationMethod submittedAt reviewedAt rejectionReason contentVersion createdAt',
      )
      .sort({ submittedAt: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('sellerId', 'shopName verificationStatus'),
    Verification.countDocuments(query),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};
const review = ({ id, admin, status, reason, expectedVersion, checkedDocuments }) =>
  transaction(async (session) => {
    const { record, profile } = await getCase(admin, id, session);
    if (String(profile.userId) === String(admin._id))
      throw new ApiError(403, 'Cần admin khác kiểm tra hồ sơ của bạn.');
    const owner = await lockOwner(profile.userId, session);
    if (profile.verificationId && String(profile.verificationId) !== String(record._id))
      throw new ApiError(409, 'Shop đã có hồ sơ mới hơn. Hãy kiểm tra hồ sơ hiện tại.');
    record.ownerId ||= profile.userId;
    if (!owner || profile.status !== 'ACTIVE')
      throw new ApiError(409, 'Chủ shop hoặc shop đang bị tạm ngưng.');
    if (record.verificationStatus !== 'PENDING' || (record.contentVersion || 0) !== expectedVersion)
      throw new ApiError(409, 'Hồ sơ đã thay đổi hoặc đã được xử lý. Hãy tải lại.');
    if (status === 'VERIFIED') {
      if (
        !checkedDocuments ||
        record.verificationMethod !== 'MANUAL_REVIEW' ||
        !record.consentAt ||
        !record.legalName
      )
        throw new ApiError(
          409,
          'Cần hồ sơ thủ công đầy đủ và xác nhận đã kiểm tra ảnh. Hồ sơ mô phỏng cũ phải gửi lại.',
        );
      const bank = await Bank.findOne({ sellerId: profile.userId }).session(session);
      if (
        !bank ||
        record.bankFingerprint !== policy.bankFingerprint(bank) ||
        policy.normalizeName(bank.accountName) !== policy.normalizeName(record.legalName)
      )
        throw new ApiError(409, 'Ngân hàng hiện tại không khớp hồ sơ đã gửi.');
      if ((await Document.countDocuments({ verificationId: id }).session(session)) !== 2)
        throw new ApiError(409, 'Hồ sơ thiếu ảnh xác minh.');
    }
    record.verificationStatus = status;
    record.reviewedAt = new Date();
    record.reviewedBy = admin._id;
    record.rejectionReason = status === 'REJECTED' ? reason : undefined;
    history(record, admin, status, reason);
    await record.save({ session });
    profile.verificationStatus = status;
    profile.verificationId = record._id;
    await profile.save({ session });
    await audit.record({
      admin,
      session,
      action: `SELLER_VERIFICATION_${status}`,
      resourceType: 'VERIFICATION',
      resourceId: record._id,
      reason,
      before: { status: 'PENDING' },
      after: { status, method: record.verificationMethod, version: record.contentVersion },
    });
    await notify(record, admin, session, status);
    return record;
  });
const invalidateBank = async (seller, oldBank, newBank, session) => {
  if (!oldBank || policy.bankFingerprint(oldBank) === policy.bankFingerprint(newBank)) return;
  const profile = await Profile.findOne({ userId: seller._id })
    .select('+verificationId +verificationVersion')
    .session(session);
  if (!profile || !['PENDING', 'VERIFIED'].includes(profile.verificationStatus)) return;
  const record =
    profile.verificationId &&
    (await Verification.findById(profile.verificationId).session(session));
  profile.verificationStatus = 'NOT_SUBMITTED';
  profile.verificationVersion = (profile.verificationVersion || 0) + 1;
  await profile.save({ session });
  if (record) {
    if (record.verificationStatus === 'PENDING') {
      record.verificationStatus = 'REJECTED';
      record.rejectionReason =
        'Tài khoản nhận tiền thay đổi trong lúc chờ duyệt. Vui lòng gửi hồ sơ mới.';
    }
    history(record, seller, 'BANK_CHANGED');
    await record.save({ session });
    await notify(record, seller, session, 'BANK_CHANGED');
  }
};
module.exports = {
  createDraft,
  updateDraft,
  detail,
  getCase,
  uploadDocument,
  removeDocument,
  documentFile,
  submitVerification,
  getStatus,
  listPending,
  review,
  invalidateBank,
};
