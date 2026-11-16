const { z } = require('zod');

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}, 'Invalid date');
const fields = { search: z.string().trim().max(100).optional(), startDate: date.optional(), endDate: date.optional() };
const validRange = query => !query.startDate || !query.endDate || query.startDate <= query.endDate;
const dateFilter = ({ startDate, endDate }, field = 'createdAt') => {
  if (!startDate && !endDate) return {};
  return { [field]: { ...(startDate ? { $gte: new Date(`${startDate}T00:00:00+07:00`) } : {}), ...(endDate ? { $lt: new Date(new Date(`${endDate}T00:00:00+07:00`).getTime() + 86400000) } : {}) } };
};
const searchFilter = (search, fields) => {
  if (!search) return {};
  const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const clauses = fields.map(field => ({ [field]: pattern }));
  if (/^[a-f\d]{24}$/i.test(search)) for (const field of ['_id', 'paymentId', 'buyerId', 'checkoutGroupId']) clauses.push({ [field]: search });
  return { $or: clauses };
};
module.exports = { fields, validRange, dateFilter, searchFilter };
