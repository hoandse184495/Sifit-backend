const reportService = require('../services/adminReport.service');
const asyncHandler = require('../utils/asyncHandler');

const sendCsv = (res, filename, csv) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csv);
};

const exportOrders = asyncHandler(async (req, res) => {
  const csv = await reportService.exportOrders(req.user, req.query, req);
  sendCsv(res, 'orders.csv', csv);
});

const exportCommissions = asyncHandler(async (req, res) => {
  const csv = await reportService.exportCommissions(req.user, req.query, req);
  sendCsv(res, 'commissions.csv', csv);
});

const exportUsers = asyncHandler(async (req, res) => {
  const csv = await reportService.exportUsers(req.user, req.query, req);
  sendCsv(res, 'users.csv', csv);
});

module.exports = { exportCommissions, exportOrders, exportUsers };
