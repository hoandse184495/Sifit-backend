const Category = require('../models/category.model');
const Product = require('../models/product.model');
const { visibleSellerIds } = require('./publicSeller.service');

const OCCASION_PROFILES = [
  {
    key: 'beach_summer',
    label: 'Đi biển & Mùa hè',
    keywords: ['biển', 'hè', 'nóng', 'mát', 'du lịch', 'summer', 'beach', 'resort', 'đi chơi xa'],
    categoryKeywords: ['áo', 'váy', 'đầm', 'phụ kiện', 'túi', 'top', 'dress', 'accessories', 'bag'],
    productKeywords: ['linen', 'cotton', 'hoa', 'ngắn', 'sáng', 'trắng', 'kem', 'xanh', 'váy', 'đầm', 'thun', 'sơ mi'],
    advice:
      'Với chuyến đi biển hoặc thời tiết mùa hè nắng ấm, chất liệu thoáng mát như **linen, cotton mỏng** cùng tông màu sáng (trắng, kem, pastel, xanh biển) sẽ giúp bạn lên hình cực kỳ nổi bật và thoải mái vận động.',
    followUps: ['Phối thêm túi & phụ kiện đi biển', 'Tìm đồ mùa hè dưới 300k', 'Chọn váy/áo sáng màu size M'],
  },
  {
    key: 'winter_cold',
    label: 'Mùa đông & Thời tiết se lạnh',
    keywords: ['đông', 'lạnh', 'ấm', 'mùa thu', 'đà lạt', 'sapa', 'winter', 'cold', 'khoác', 'len', 'hoodie', 'sweater', 'cardigan', 'trench'],
    categoryKeywords: ['khoác', 'outerwear', 'jacket', 'áo', 'quần', 'giày', 'boots'],
    productKeywords: ['khoác', 'jacket', 'blazer', 'len', 'wool', 'nỉ', 'hoodie', 'sweater', 'cardigan', 'dạ', 'da', 'jean', 'denim'],
    advice:
      'Trong thời tiết se lạnh, công thức **layering (phối nhiều lớp)** với áo khoác form đứng (Blazer, Denim Jacket, Cardigan hoặc Hoodie nỉ) kết hợp cùng quần cạp cao sẽ vừa giữ ấm vừa tạo tỷ lệ cơ thể cân đối, tôn dáng.',
    followUps: ['Tìm áo khoác dễ phối đồ', 'Gợi ý set đồ đi Đà Lạt', 'Đồ thu đông form rộng (Oversize)'],
  },
  {
    key: 'party_date',
    label: 'Dự tiệc & Hẹn hò',
    keywords: ['tiệc', 'hẹn hò', 'party', 'cưới', 'sang', 'lịch sự', 'thanh lịch', 'date', 'event', 'tối', 'dinner', 'kỷ niệm'],
    categoryKeywords: ['đầm', 'váy', 'dress', 'khoác', 'túi', 'giày', 'phụ kiện'],
    productKeywords: ['đầm', 'váy', 'blazer', 'lụa', 'satin', 'đen', 'đỏ', 'kem', 'ôm', 'xòe', 'cao gót', 'túi'],
    advice:
      'Cho buổi tiệc hoặc hẹn hò, điểm nhấn nằm ở **phom dáng chiết eo nhẹ hoặc chất liệu có độ rủ/bóng nhẹ (satin, lụa, tweed, blazer may đo)**. Kết hợp thêm một chiếc túi xách nhỏ gọn sẽ giúp tổng thể sang trọng mà không bị rườm rà.',
    followUps: ['Tìm đầm dự tiệc tôn dáng', 'Phối Blazer thanh lịch', 'Tìm túi xách & giày đi tiệc'],
  },
  {
    key: 'office_smart',
    label: 'Công sở & Đi học thanh lịch',
    keywords: ['công sở', 'đi làm', 'đi học', 'văn phòng', 'office', 'smart', 'basic', 'tối giản', 'minimal', 'minimalist', 'sơ mi', 'quần tây'],
    categoryKeywords: ['áo', 'quần', 'váy', 'khoác', 'túi', 'giày'],
    productKeywords: ['sơ mi', 'blazer', 'quần', 'chân váy', 'tây', 'basic', 'trắng', 'đen', 'be', 'xám', 'nâu', 'midi'],
    advice:
      'Phong cách Smart Casual / Tối giản cho ngày đi làm, đi học ưu tiên các gam màu trung tính (**trắng, be, đen, xám, xanh navy**). Một chiếc sơ mi hoặc áo kiểu tinh gọn sơ vin cùng quần ống suông/chân váy chữ A sẽ giúp bạn trông cao ráo và chỉn chu cả ngày.',
    followUps: ['Set đồ công sở dưới 500k', 'Tìm áo sơ mi & blazer basic', 'Quần ống suông tôn dáng'],
  },
  {
    key: 'vintage_retro',
    label: 'Vintage & Retro Secondhand',
    keywords: ['vintage', 'retro', 'cổ điển', '90s', 'y2k', 'secondhand', '2hand', 'thrift', 'độc', 'hiếm'],
    categoryKeywords: ['áo', 'khoác', 'quần', 'váy', 'túi', 'phụ kiện'],
    productKeywords: ['vintage', 'retro', 'jean', 'denim', 'da', 'hoa', 'kẻ', 'caro', 'oversize', 'levi', 'nhung', 'corduroy'],
    advice:
      'Điểm cuốn hút nhất của đồ **Vintage / Pre-loved** là chất vải bền bỉ và phom dáng độc bản. Bạn có thể phối một món chủ đạo mang hơi hướng thập niên 90s (như Denim, sơ mi họa tiết hoặc áo khoác cổ điển) cùng phụ kiện tối giản để tạo chất riêng.',
    followUps: ['Tìm đồ Denim / Jeans cổ điển', 'Gợi ý món đồ độc bản độ mới cao', 'Phối đồ Vintage dạo phố'],
  },
  {
    key: 'streetwear_casual',
    label: 'Dạo phố & Streetwear năng động',
    keywords: ['dạo phố', 'streetwear', 'cá tính', 'năng động', 'cà phê', 'cafe', 'cuối tuần', 'oversize', 'rộng', 'thể thao', 'hiphop', 'jeans'],
    categoryKeywords: ['áo', 'quần', 'khoác', 'giày', 'túi', 'phụ kiện'],
    productKeywords: ['thun', 'tee', 'hoodie', 'jean', 'denim', 'cargo', 'sneaker', 'rộng', 'oversize', 'năng động', 'khoác'],
    advice:
      'Với buổi dạo phố hay cà phê cuối tuần, sự thoải mái và phom dáng phóng khoáng là ưu tiên số một. Áo phông/khoác nhẹ phối cùng quần Jeans hoặc chân váy năng động và giày êm chân sẽ tạo nên tổng thể trẻ trung, cuốn hút.',
    followUps: ['Tìm đồ đi cà phê cuối tuần', 'Gợi ý giày & túi đeo chéo', 'Đồ năng động độ mới trên 90%'],
  },
];

const parseBudget = (text) => {
  const normalized = text.toLowerCase();
  const millionMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*(triệu|tr|m)\b/);
  if (millionMatch) {
    const val = parseFloat(millionMatch[1].replace(',', '.'));
    if (!Number.isNaN(val) && val > 0) return Math.round(val * 1000000);
  }
  const thousandMatch = normalized.match(/(\d{2,4})\s*(k|nghìn|ngàn|ng)\b/);
  if (thousandMatch) {
    const val = parseInt(thousandMatch[1], 10);
    if (!Number.isNaN(val) && val > 0) return val * 1000;
  }
  const vndMatch = normalized.match(/(\d{3})[.,](\d{3})\s*(đ|vnd|đồng)?/);
  if (vndMatch) {
    return parseInt(`${vndMatch[1]}${vndMatch[2]}`, 10);
  }
  return null;
};

const parseBodyAndSize = (text, preferredSize) => {
  if (preferredSize && preferredSize !== 'ALL') {
    return {
      size: preferredSize === 'Freesize' ? 'FREE_SIZE' : preferredSize.toUpperCase(),
      note: `Mình đã ưu tiên lọc các món có kích thước **${preferredSize}** (hoặc Freesize dễ mặc) theo lựa chọn của bạn.`,
    };
  }

  const upper = text.toUpperCase();
  const explicitSize = upper.match(/\b(XXL|XL|XS|FREE\s*SIZE|FREESIZE)\b/) || text.match(/\bsize\s*(s|m|l|xl|xxl|xs)\b/i);
  if (explicitSize) {
    const raw = (explicitSize[1] || explicitSize[0]).toUpperCase().replace(/\s+/g, '');
    const normalized = raw.includes('FREE') ? 'FREE_SIZE' : raw;
    return {
      size: normalized,
      note: `Mình đã ưu tiên tìm các thiết kế thuộc size **${normalized === 'FREE_SIZE' ? 'Freesize' : normalized}** vừa vặn với bạn.`,
    };
  }

  const weightMatch = text.toLowerCase().match(/(\d{2,3})\s*(kg|kí|ký)/);
  const heightMatch = text.toLowerCase().match(/1\s*[m.]?\s*(\d{2})\b|(\d{3})\s*cm/);

  if (weightMatch) {
    const kg = parseInt(weightMatch[1], 10);
    let suggested = 'M';
    if (kg <= 46) suggested = 'S';
    else if (kg <= 55) suggested = 'M';
    else if (kg <= 64) suggested = 'L';
    else suggested = 'XL';

    const heightNote = heightMatch ? ' và chiều cao của bạn' : '';
    return {
      size: suggested,
      note: `Dựa trên cân nặng **${kg}kg**${heightNote}, size **${suggested}** (hoặc đồ phom **Freesize**) sẽ mang lại độ vừa vặn và tôn dáng nhất.`,
    };
  }

  if (
    text.toLowerCase().includes('quả lê') ||
    text.toLowerCase().includes('đầy đặn') ||
    text.toLowerCase().includes('che bụng') ||
    text.toLowerCase().includes('bắp tay')
  ) {
    return {
      size: null,
      note: 'Với mong muốn tôn dáng và che khuyết điểm khéo léo, bạn nên ưu tiên các thiết kế **cạp cao, chữ A hoặc khoác ngoài phom đứng**.',
    };
  }

  return { size: null, note: null };
};

const fetchEligibleProducts = async () => {
  const rawProducts = await Product.find({ status: 'ACTIVE', deletedAt: null })
    .sort({ createdAt: -1 })
    .limit(120)
    .populate({ path: 'categoryId', select: 'name slug' })
    .populate({ path: 'sellerId', select: 'fullName avatar' })
    .lean();

  if (!rawProducts.length) return [];

  const sellerIds = rawProducts.map((p) => p.sellerId?._id).filter(Boolean);
  const visibleSet = await visibleSellerIds(sellerIds);
  const filtered = rawProducts.filter((p) => visibleSet.has(String(p.sellerId?._id)));

  // Fallback to all active products if seller stage filtering leaves 0 in local demo environment
  return filtered.length > 0 ? filtered : rawProducts;
};

const getQuickPrompts = async () => {
  const [categories, activeCount] = await Promise.all([
    Category.find({ isActive: true }).select('name slug').sort({ name: 1 }).lean(),
    Product.countDocuments({ status: 'ACTIVE', deletedAt: null }),
  ]);

  return {
    activeProductCount: activeCount,
    categories,
    quickPrompts: [
      {
        id: 'party',
        label: 'Đi tiệc & Hẹn hò',
        prompt: 'Gợi ý giúp mình set đồ đi tiệc tối hoặc hẹn hò thật thanh lịch, tôn dáng.',
      },
      {
        id: 'streetwear',
        label: 'Dạo phố cuối tuần',
        prompt: 'Mình muốn tìm outfit dạo phố cà phê cuối tuần năng động, trẻ trung.',
      },
      {
        id: 'office',
        label: 'Công sở tối giản',
        prompt: 'Tư vấn phối đồ đi làm, đi học phong cách tối giản (Smart Casual) dễ mặc.',
      },
      {
        id: 'vintage',
        label: 'Vintage độc bản',
        prompt: 'Gợi ý cho mình những món đồ phong cách Vintage / Retro cá tính đang có sẵn.',
      },
      {
        id: 'winter',
        label: 'Mùa lạnh / Đà Lạt',
        prompt: 'Mình sắp đi du lịch nơi se lạnh, gợi ý giúp mình áo khoác và đồ phối ấm áp.',
      },
      {
        id: 'budget',
        label: 'Săn đồ đẹp dưới 300k',
        prompt: 'Tìm giúp mình những món đồ độ mới cao, dễ phối với ngân sách dưới 300k.',
      },
    ],
  };
};

const recommendOutfit = async ({ message = '', history = [], preferences = {} }) => {
  const cleanMessage = String(message || '').trim();
  const contextText = [
    ...history.slice(-3).map((item) => item?.text || ''),
    cleanMessage,
    preferences.occasion || '',
    preferences.style || '',
  ]
    .join(' ')
    .toLowerCase();

  const products = await fetchEligibleProducts();

  if (!products.length) {
    return {
      reply:
        'Hiện tại kho sản phẩm đang được cập nhật thêm mẫu mới. Bạn hãy quay lại sau ít phút hoặc ghé mục Cửa hàng để xem các danh mục nhé!',
      detectedContext: {},
      products: [],
      outfitSummary: null,
      followUps: ['Xem tất cả danh mục', 'Cách bán đồ trên Sifit'],
    };
  }

  // Detect occasion profile
  let bestProfile = null;
  let bestProfileHits = 0;
  for (const profile of OCCASION_PROFILES) {
    const hits = profile.keywords.reduce(
      (acc, kw) => (contextText.includes(kw) ? acc + (cleanMessage.toLowerCase().includes(kw) ? 3 : 1) : acc),
      0,
    );
    if (hits > bestProfileHits) {
      bestProfileHits = hits;
      bestProfile = profile;
    }
  }

  const budget = preferences.maxPrice ? Number(preferences.maxPrice) : parseBudget(cleanMessage) || parseBudget(contextText);
  const { size: targetSize, note: sizeNote } = parseBodyAndSize(cleanMessage, preferences.size);

  // Extract direct tokens from the current message
  const messageTokens = cleanMessage
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 2 && !['mình', 'cho', 'với', 'cần', 'tìm', 'muốn', 'gợi', 'như', 'thế', 'nào', 'giúp', 'nhé', 'bạn'].includes(word));

  // Score each product
  const scored = products.map((product) => {
    let score = 0;
    const titleLower = (product.title || '').toLowerCase();
    const descLower = (product.description || '').toLowerCase();
    const brandLower = (product.brand || '').toLowerCase();
    const colorLower = (product.color || '').toLowerCase();
    const catNameLower = (product.categoryId?.name || '').toLowerCase();
    const catSlugLower = (product.categoryId?.slug || '').toLowerCase();
    const fullText = `${titleLower} ${descLower} ${brandLower} ${colorLower} ${catNameLower} ${catSlugLower}`;

    // Direct token match
    for (const token of messageTokens) {
      if (titleLower.includes(token)) score += 6;
      else if (catNameLower.includes(token) || brandLower.includes(token) || colorLower.includes(token)) score += 5;
      else if (descLower.includes(token)) score += 2;
    }

    // Profile match
    if (bestProfile) {
      for (const kw of bestProfile.productKeywords) {
        if (fullText.includes(kw)) score += 4;
      }
      for (const ckw of bestProfile.categoryKeywords) {
        if (catNameLower.includes(ckw) || catSlugLower.includes(ckw)) score += 2;
      }
    }

    // Size match
    if (targetSize) {
      if (product.size === targetSize) score += 8;
      else if (product.size === 'FREE_SIZE') score += 4;
      else score -= 3;
    }

    // Budget match
    if (budget && budget > 0) {
      if (product.price <= budget) score += 7;
      else if (product.price <= budget * 1.2) score += 1;
      else score -= 6;
    }

    // High condition bonus
    if (product.condition === 'NEW_WITH_TAGS') score += 3;
    else if (product.condition === 'LIKE_NEW') score += 2;

    return { product, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Pick diverse categories so the recommendation feels like a curated outfit
  const selected = [];
  const usedCategories = new Set();
  for (const item of scored) {
    if (selected.length >= 4) break;
    const catId = String(item.product.categoryId?._id || item.product.categoryId || '');
    if (!usedCategories.has(catId) || item.score >= 8) {
      selected.push(item.product);
      if (catId) usedCategories.add(catId);
    }
  }
  for (const item of scored) {
    if (selected.length >= 4) break;
    if (!selected.some((p) => String(p._id) === String(item.product._id))) {
      selected.push(item.product);
    }
  }

  const totalOutfitPrice = selected.reduce((sum, p) => sum + (p.price || 0), 0);

  // Compose natural response
  const parts = [];
  if (bestProfile) {
    parts.push(`✨ **Gợi ý phối đồ ${bestProfile.label}:**\n${bestProfile.advice}`);
  } else {
    parts.push(
      '✨ **Gợi ý phối đồ dành riêng cho bạn:**\nMình đã rà soát tủ đồ Sifit để chọn ra các thiết kế có phom dáng hài hòa, độ mới cao và dễ kết hợp cùng nhau nhất.',
    );
  }

  if (sizeNote) {
    parts.push(sizeNote);
  }

  if (budget && budget > 0) {
    parts.push(
      `💰 Về ngân sách **dưới ${budget.toLocaleString('vi-VN')}đ/món**, các sản phẩm bên dưới đều có mức giá rất hợp lý để bạn dễ dàng sở hữu trọn bộ:`,
    );
  } else {
    parts.push(
      '👗 Dưới đây là những món đồ đang **có sẵn trên sàn** phù hợp nhất với yêu cầu của bạn. Bạn có thể bấm vào từng món để xem chi tiết hoặc thêm ngay vào giỏ hàng nhé:',
    );
  }

  return {
    reply: parts.join('\n\n'),
    detectedContext: {
      occasion: bestProfile?.label || 'Phối đồ linh hoạt',
      suggestedSize: targetSize === 'FREE_SIZE' ? 'Freesize' : targetSize || 'Mọi kích cỡ',
      maxBudget: budget || null,
    },
    products: selected,
    outfitSummary: {
      itemCount: selected.length,
      totalPrice: totalOutfitPrice,
    },
    followUps:
      bestProfile?.followUps || [
        'Tư vấn đồ đi tiệc sang trọng',
        'Tìm đồ dạo phố dưới 300k',
        'Gợi ý theo chiều cao & cân nặng của mình',
      ],
  };
};

module.exports = {
  getQuickPrompts,
  recommendOutfit,
};
