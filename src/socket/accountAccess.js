const User = require('../models/user.model');
const ApiError = require('../utils/ApiError');
const refreshSocketUser = async (socket) => {
  const user = await User.findOne({ _id: socket.user?._id, status: 'ACTIVE' });
  if (!user) throw new ApiError(403, 'Tài khoản đã bị khóa hoặc không còn khả dụng.');
  if ((socket.data?.tokenVersion || 0) !== (user.tokenVersion || 0)) throw new ApiError(403, 'Mật khẩu đã thay đổi. Vui lòng đăng nhập lại.');
  socket.user = user;
  return user;
};
const rejectSocket = (socket, event, args, error) => {
  const ack = args.at(-1);
  const message =
    error.statusCode === 403 ? error.message : 'Chưa kiểm tra được phiên chat. Vui lòng thử lại.';
  if (typeof ack === 'function') ack({ ok: false, message });
  socket.emit('message:error', { event, message });
  if (error.statusCode === 403) {
    socket.emit('account:suspended', { message });
    socket.disconnect(true);
  }
};
const installAccountAccess = (socket) => {
  socket.use(async ([event, ...args], next) => {
    try {
      await refreshSocketUser(socket);
      if (socket.connected) next();
    } catch (error) {
      rejectSocket(socket, event, args, error);
    }
  });
};
module.exports = { refreshSocketUser, installAccountAccess };
