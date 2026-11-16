function tryonSettings(engine = 'v1.6') {
  if (engine === 'v1.6') return { engine, model: 'tryon-v1.6', quality: 'quality', credits: 1, resolution: '864x1296' };
  if (engine === 'max') return { engine, model: 'tryon-max', quality: 'balanced', credits: 2, resolution: '1k' };
  if (engine === 'outfit') return { engine, model: 'tryon-max', quality: 'balanced', credits: 2, resolution: '1k' };
  const error = new Error('Model thử đồ không hợp lệ.'); error.status = 400; throw error;
}
function settingsForProduct(product, preference = 'v1.6') {
  return tryonSettings(preference === 'max' || ['Footwear', 'Accessories'].includes(product.category) ? 'max' : 'v1.6');
}
function garmentCategory(product) {
  if (product.garmentCategory === 'one-pieces') return 'one-pieces';
  if (/dress|đầm|váy liền/i.test(product.title) && !/skirt|chân váy/i.test(product.title)) return 'one-pieces';
  return product.category === 'Bottoms' ? 'bottoms' : 'tops';
}
function providerInputs(image, garmentImage, product, seed, settings) {
  const mime = image[0] === 0xff && image[1] === 0xd8 ? 'jpeg' : 'png';
  const common = { model_image: `data:image/${mime};base64,${image.toString('base64')}`, seed, output_format: 'png', return_base64: true };
  if (['max', 'outfit'].includes(settings.engine)) {
    const prompt = product.outfit ? `The reference collage contains ${product.itemCount} numbered product panels. Identify the selected fashion item indicated by each panel label and dress the target person in ALL ${product.itemCount} items together as one complete coordinated outfit. Preserve each item's design, color and pattern. Keep the target person's identity, body shape and pose. Ignore people and other unselected clothes worn by the reference models. Do not omit a selected item.` : product.garmentPhotoType === 'model' ? ({ Tops: 'Change only the top.', Bottoms: garmentCategory(product) === 'one-pieces' ? 'Try on this dress.' : 'Change only the bottoms.', Outerwear: 'Try on this jacket.' }[product.category]) : undefined;
    return { model_name: settings.model, inputs: { ...common, product_image: garmentImage, resolution: '1k', generation_mode: 'balanced', num_images: 1, ...(prompt ? { prompt } : {}) } };
  }
  return { model_name: settings.model, inputs: { ...common, garment_image: garmentImage, category: garmentCategory(product), mode: 'quality', garment_photo_type: product.garmentPhotoType || 'auto', segmentation_free: true, num_samples: 1 } };
}

module.exports = { tryonSettings, settingsForProduct, garmentCategory, providerInputs };
