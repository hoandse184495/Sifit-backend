const mongoose = require('mongoose');
const env = require('../src/config/env');
const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const Category = require('../src/models/category.model');
const slugify = require('../src/utils/slugify');

const categories = ['Áo', 'Quần', 'Váy', 'Đầm', 'Áo khoác', 'Giày dép', 'Túi xách', 'Phụ kiện'];

const seedCategories = async () => {
  await connectDatabase();

  for (const name of categories) {
    await Category.updateOne(
      { slug: slugify(name) },
      {
        $setOnInsert: {
          name,
          slug: slugify(name),
          isActive: true,
        },
      },
      { upsert: true },
    );
  }

  await disconnectDatabase();
};

seedCategories()
  .then(() => {
    console.info(`Seeded categories for ${env.NODE_ENV}`);
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(`Category seed failed: ${error.message}`);

    if (mongoose.connection.readyState !== 0) {
      await disconnectDatabase();
    }

    process.exit(1);
  });
