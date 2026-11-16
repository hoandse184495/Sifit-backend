const mongoose = require('mongoose');
const sharp = require('sharp');
const { randomInt } = require('node:crypto');
const env = require('../config/env');
const Job = require('../models/stylistJob.model');
const Budget = require('../models/stylistBudget.model');
const Product = require('../models/product.model');
const { visibleSellerIds } = require('./publicSeller.service');
const ApiError = require('../utils/ApiError');

// Provider parameters and per-member limits come from the original fe-redesign AI branch.
const settingsModule = () => require('./stylist/tryonSettings');
const quotaModule = () => require('./stylist/quota');
const available = () => env.TRYON_MODE === 'live' && !!env.FASHN_API_KEY;
const stepCount = job => job.engine === 'outfit' ? 1 : job.products.length;
const stepSettings = job => {
  const { tryonSettings, settingsForProduct } = settingsModule();
  return job.engine === 'outfit' ? [tryonSettings('outfit')] : job.products.map(p => settingsForProduct(p, job.engine));
};
const summary = job => ({
  id: job.id, status: job.status, engine: job.engine, products: job.products,
  cost: job.cost, step: job.step, totalSteps: stepCount(job),
  phase: job.phase, error: job.error, createdAt: job.createdAt, expiresAt: job.expiresAt,
});
async function counters(userId) {
  const { periods } = await quotaModule();
  const { day, month } = periods();
  return [
    { id: `day:${userId}:${day}`, limit: 5 },
    { id: `month:${userId}:${month}`, limit: 10 },
    { id: `global:${month}`, limit: env.FASHN_MONTHLY_BUDGET },
  ];
}
async function state(userId) {
  const limits = await counters(userId);
  const counts = await Budget.find({ _id: { $in: limits.map(x => x.id) } }).lean();
  const remaining = limits.map(x => Math.max(0, x.limit - (counts.find(c => c._id === x.id)?.used || 0)));
  const jobs = await Job.find({ userId, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).limit(20);
  return { enabled: available(), quota: { daily: remaining[0], monthly: remaining[1], remaining: Math.min(...remaining) }, jobs: jobs.map(summary) };
}
function category(product) {
  const name = `${product.categoryId?.slug || ''} ${product.categoryId?.name || ''}`;
  if (/shoe|footwear|giày|giay|dép|dep/i.test(name)) return 'Footwear';
  if (/accessor|phụ kiện|phu-kien|túi|tui/i.test(name)) return 'Accessories';
  if (/outer|jacket|khoác|khoac/i.test(name)) return 'Outerwear';
  if (/bottom|pants|skirt|dress|quần|quan|váy|vay|đầm|dam/i.test(name)) return 'Bottoms';
  if (/top|shirt|áo|ao/i.test(name)) return 'Tops';
  throw new ApiError(400, 'Danh mục sản phẩm này chưa hỗ trợ thử đồ.');
}
async function create(userId, input, file) {
  if (!available()) throw new ApiError(503, 'Phòng thử đồ đang được chuẩn bị. Vui lòng quay lại sau.');
  if (!/^[\w-]{16,80}$/.test(input.requestId || '')) throw new ApiError(400, 'Mã lượt thử không hợp lệ.');
  const existing = await Job.findOne({ userId, requestId: input.requestId });
  if (existing) return existing;
  if (input.consent !== 'true') throw new ApiError(400, 'Vui lòng đồng ý gửi ảnh của bạn đến FASHN để thử đồ.');
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) throw new ApiError(400, 'Chọn ảnh JPEG, PNG hoặc WebP, tối đa 8 MB.');
  let ids;
  try { ids = JSON.parse(input.productIds); } catch { throw new ApiError(400, 'Danh sách sản phẩm không hợp lệ.'); }
  if (!Array.isArray(ids) || !ids.length || ids.length > (input.engine === 'outfit' ? 4 : 3) || new Set(ids).size !== ids.length || ids.some(id => !mongoose.isValidObjectId(id))) throw new ApiError(400, 'Chọn tối đa 3 món, hoặc 4 món ở chế độ cả set.');
  if (!['v1.6', 'max', 'outfit'].includes(input.engine)) throw new ApiError(400, 'Chế độ thử đồ không hợp lệ.');
  const found = await Product.find({ _id: { $in: ids }, status: 'ACTIVE', deletedAt: null }).populate('categoryId');
  const visible = await visibleSellerIds(found.map(p => p.sellerId));
  if (found.length !== ids.length || found.some(p => !visible.has(String(p.sellerId)) || !p.images[0])) throw new ApiError(400, 'Sản phẩm đã ngừng bán hoặc chưa có ảnh.');
  const order = ['Bottoms', 'Tops', 'Outerwear', 'Footwear', 'Accessories'];
  const products = ids.map(id => found.find(p => String(p._id) === id)).map(p => ({ _id: String(p._id), title: p.title, category: category(p), garmentCategory: /dress|đầm|^dam$/i.test(p.categoryId?.slug || p.categoryId?.name || '') ? 'one-pieces' : undefined, images: [p.images[0].url] })).sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
  if (new Set(products.map(p => p.category)).size !== products.length) throw new ApiError(400, 'Mỗi lượt chọn tối đa một món trong mỗi nhóm trang phục.');
  const { settingsForProduct, garmentCategory } = await settingsModule();
  if (products.some(p => garmentCategory(p) === 'one-pieces') && products.some(p => ['Tops', 'Bottoms'].includes(p.category) && garmentCategory(p) !== 'one-pieces')) throw new ApiError(400, 'Hãy thử váy liền riêng với áo hoặc quần.');
  const cost = input.engine === 'outfit' ? 2 : products.reduce((sum, p) => sum + settingsForProduct(p, input.engine).credits, 0);
  let photo;
  try { photo = await sharp(file.buffer, { limitInputPixels: 25000000 }).rotate().resize({ width: 1080, height: 1620, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#fff' }).jpeg({ quality: 90 }).toBuffer(); }
  catch { throw new ApiError(400, 'Không đọc được ảnh. Hãy chọn ảnh khác rõ toàn thân.'); }
  const limits = await counters(userId);
  // Initialize outside the transaction so concurrent first requests share the same counters.
  for (const item of limits) await Budget.updateOne({ _id: item.id }, { $setOnInsert: { used: 0 } }, { upsert: true });
  let job;
  try {
    await mongoose.connection.transaction(async session => {
      for (const item of limits) {
        const updated = await Budget.updateOne({ _id: item.id, used: { $lte: item.limit - cost } }, { $inc: { used: cost } }, { session });
        if (!updated.modifiedCount) throw new ApiError(429, 'Không đủ lượt còn lại. Hạn mức là 5 credit/ngày, 10 credit/tháng và ngân sách chung.');
      }
      [job] = await Job.create([{ userId, requestId: input.requestId, products, engine: input.engine, cost, photo, seed: randomInt(0, 2147483647), counterIds: limits.map(x => x.id), consentAt: new Date() }], { session });
    });
  } catch (error) {
    if (error.code === 11000) {
      const duplicate = await Job.findOne({ userId, requestId: input.requestId });
      if (duplicate) return duplicate;
      throw new ApiError(409, 'Bạn đang có một lượt thử. Hãy đợi kết quả trước khi tạo lượt mới.');
    }
    throw error;
  }
  return job;
}
async function provider(path, options = {}) {
  const response = await globalThis.fetch(`https://api.fashn.ai/v1/${path}`, {
    ...options, headers: { Authorization: `Bearer ${env.FASHN_API_KEY}`, 'Content-Type': 'application/json' },
    signal: globalThis.AbortSignal.timeout(options.method === 'POST' ? 90000 : 30000),
  });
  if (!response.ok) {
    const error = new Error(`Provider HTTP ${response.status}`);
    error.rejected = options.method === 'POST' && response.status >= 400 && response.status < 500;
    error.providerStatus = response.status;
    throw error;
  }
  return response.json();
}
async function fail(job, message, confirmed) {
  if (!confirmed) {
    await Job.updateOne({ _id: job._id, status: { $nin: ['completed', 'failed'] } }, { status: 'attention', phase: 'attention', error: message });
    return;
  }
  const refund = stepSettings(job).slice(job.step).reduce((sum, setting) => sum + setting.credits, 0);
  await mongoose.connection.transaction(async session => {
    const update = await Job.updateOne({ _id: job._id, refunded: false, status: { $ne: 'completed' } }, { status: 'failed', active: false, phase: 'failed', error: message, refunded: true, $unset: { photo: 1 } }, { session });
    if (update.modifiedCount) for (const id of job.counterIds) await Budget.updateOne({ _id: id }, { $inc: { used: -refund } }, { session });
  });
}
async function advance(job) {
  if (!available()) return;
  const { providerInputs } = await settingsModule();
  const locked = await Job.findOneAndUpdate({ _id: job._id, phase: 'queued' }, { phase: 'submitting', status: 'running' }, { new: true }).select('+photo +output');
  if (!locked) return;
  try {
    let product = locked.products[locked.step];
    if (locked.engine === 'outfit') {
      try { product = await require('./stylist/outfitReference').outfitProduct(locked.products); }
      catch (error) { error.rejected = true; throw error; }
    }
    const settings = stepSettings(locked)[locked.step];
    const data = await provider('run', { method: 'POST', body: JSON.stringify(providerInputs(locked.output || locked.photo, product.images[0], product, locked.seed, settings)) });
    if (!data.id || data.error) return fail(locked, 'AI từ chối ảnh đầu vào. Các bước chưa thực hiện đã được hoàn hạn mức.', true);
    await Job.updateOne({ _id: job._id }, { predictionId: data.id, phase: 'processing' });
  } catch (error) {
    const message = error.providerStatus === 402 ? 'Dịch vụ đang hết credit. Các bước chưa thực hiện đã được hoàn hạn mức.' : error.rejected ? 'AI từ chối lượt thử. Hãy kiểm tra ảnh và thử lại; các bước chưa thực hiện đã được hoàn hạn mức.' : 'Kết nối bị gián đoạn sau khi gửi yêu cầu. Lượt được giữ lại để tránh gọi trùng; vui lòng liên hệ hỗ trợ.';
    await fail(locked, message, !!error.rejected);
  }
}
async function poll(job) {
  if (job.phase === 'queued') { void advance(job).catch(() => {}); return; }
  if (job.phase === 'submitting' && Date.now() - job.updatedAt.getTime() > 120000) return fail(job, 'Yêu cầu đã gửi nhưng chưa xác định được trạng thái. Liên hệ hỗ trợ; hệ thống sẽ không tự tạo lượt trả phí khác.', false);
  if (!['processing', 'attention'].includes(job.phase) || !job.predictionId) return;
  const result = await provider(`status/${encodeURIComponent(job.predictionId)}`);
  if (result.status === 'failed' || result.error) return fail(job, 'AI không xử lý được ảnh. Các bước chưa hoàn tất đã được hoàn hạn mức.', true);
  if (result.status !== 'completed') return;
  const value = result.output?.[0];
  if (typeof value !== 'string' || !/^data:image\/(png|jpeg);base64,/.test(value) || value.length > 20 * 1024 * 1024) return fail(job, 'Kết quả AI chưa đọc được. Vui lòng liên hệ hỗ trợ để kiểm tra lượt đã thực hiện.', false);
  const output = await sharp(Buffer.from(value.slice(value.indexOf(',') + 1), 'base64'), { limitInputPixels: 25000000 }).resize({ width: 1440, height: 2160, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
  const finished = job.step + 1 === stepCount(job);
  const update = { output, step: job.step + 1, status: finished ? 'completed' : 'running', phase: finished ? 'completed' : 'queued', active: !finished, $unset: { predictionId: 1, ...(finished ? { photo: 1 } : {}) } };
  await Job.updateOne({ _id: job._id, predictionId: job.predictionId, step: job.step }, update);
}
async function get(userId, id) {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(404, 'Không tìm thấy lượt thử.');
  let job = await Job.findOne({ _id: id, userId, expiresAt: { $gt: new Date() } });
  if (!job) throw new ApiError(404, 'Không tìm thấy lượt thử hoặc ảnh đã hết hạn.');
  if (job.active) {
    try { await poll(job); } catch { /* Polling is read-only at the provider; retry without a second paid submission. */ }
    job = await Job.findById(id);
  }
  return summary(job);
}
module.exports = { available, state, create, get, summary, advance, category };
