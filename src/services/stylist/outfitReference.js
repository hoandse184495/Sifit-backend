const sharp = require('sharp');
const process = require('node:process');
const { URL } = require('node:url');

function supportsOutfit(items) {
  return items.length >= 1 && items.length <= 4 && new Set(items.map(p => p._id)).size === items.length && new Set(items.map(p => p.category)).size === items.length;
}
async function productPhoto(product) {
  const source = product.images[0];
  if (process.env.NODE_ENV === 'test' && /^data:image\/(png|jpeg);base64,/.test(source)) return Buffer.from(source.slice(source.indexOf(',') + 1), 'base64');
  const url = new URL(source);
  if (url.protocol !== 'https:' || !['res.cloudinary.com', 'images.unsplash.com', 'assets.myntassets.com'].includes(url.hostname)) throw new Error('Unsupported reference source');
  const response = await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(20000), redirect: 'error' });
  if (!response.ok) throw new Error('Reference download failed');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) { await response.body.cancel?.().catch(() => {}); throw new Error('Reference too large'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function composeOutfitReference(items) {
  if (!supportsOutfit(items)) throw new Error('Outfit reference requires 1–4 unique items, one per category');
  const order = ['Tops', 'Bottoms', 'Outerwear', 'Footwear', 'Accessories'];
  const ordered = [...items].sort((a,b) => order.indexOf(a.category)-order.indexOf(b.category));
  const columns = items.length === 1 ? 1 : 2, rows = Math.ceil(items.length / columns);
  const width = 24 + columns * 792, height = 24 + rows * 1176;
  const panels = [];
  const labels = { Tops: 'TOP', Bottoms: 'TROUSERS / SKIRT / DRESS', Outerwear: 'OUTERWEAR', Footwear: 'SHOES', Accessories: 'ACCESSORY' };
  for (let i = 0; i < ordered.length; i++) {
    const input = await sharp(await productPhoto(ordered[i]), { limitInputPixels: 25000000 }).rotate().resize(768, 1120, { fit: 'contain', background: '#fff' }).flatten({ background: '#fff' }).png().toBuffer();
    const left = 24 + (i % columns) * 792, top = 24 + Math.floor(i / columns) * 1176;
    panels.push({ input, left, top: top + 24 });
    panels.push({ input: Buffer.from(`<svg width="768" height="24"><text x="12" y="20" font-size="18">ITEM ${i+1}: ${labels[ordered[i].category] || 'PRODUCT'}</text></svg>`), left, top });
  }
  return sharp({ create: { width, height, channels: 3, background: '#fff' } }).composite(panels).jpeg({ quality: 95 }).toBuffer();
}
async function outfitProduct(items) {
  const reference = await composeOutfitReference(items);
  return { category: 'Tops', title: 'Complete selected outfit', outfit: true, itemCount: items.length, images: [`data:image/jpeg;base64,${reference.toString('base64')}`] };
}

module.exports = { supportsOutfit, composeOutfitReference, outfitProduct };
