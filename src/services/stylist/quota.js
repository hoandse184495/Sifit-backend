const DAILY_LIMIT = 5;
const MONTHLY_LIMIT = 10;
function periods(now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return { day, month: day.slice(0, 7) };
}
function quota(usage, userId, mode, now = new Date()) {
  const { day, month } = periods(now);
  const own = usage.filter(u => u.userId === userId && u.mode === mode && !u.refunded && !u.allowanceResetAt);
  const dailyUsed = own.filter(u => u.day === day).length;
  const monthlyUsed = own.filter(u => u.month === month).length;
  return { dailyUsed, monthlyUsed, dailyLimit: DAILY_LIMIT, monthlyLimit: MONTHLY_LIMIT, remaining: Math.max(0, Math.min(DAILY_LIMIT - dailyUsed, MONTHLY_LIMIT - monthlyUsed)) };
}
function canReserve(usage, userId, mode, count, globalLimit, now = new Date()) {
  if (!Number.isInteger(count) || count < 1 || count > 6) return false;
  const { month } = periods(now);
  return quota(usage, userId, mode, now).remaining >= count && usage.filter(u => u.mode === mode && u.month === month && !u.refunded).length + count <= globalLimit;
}

module.exports = { DAILY_LIMIT, MONTHLY_LIMIT, periods, quota, canReserve };
