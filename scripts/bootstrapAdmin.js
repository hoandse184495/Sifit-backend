const argon2 = require('argon2');
const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const User = require('../src/models/user.model');
const { registerSchema } = require('../src/validations/auth.validation');

const run = async () => {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  const { body: input } = registerSchema.parse({ body: { email, password, fullName: 'Sifit Admin', role: 'BUYER' } });
  await connectDatabase();
  try {
    if (await User.exists({ role: 'ADMIN' })) throw new Error('An admin already exists');
    if (await User.exists({ email: input.email })) throw new Error('Email already exists; no account was changed');
    await User.create({ fullName: input.fullName, email: input.email, passwordHash: await argon2.hash(input.password), role: 'ADMIN' });
    console.info('First administrator created. Remove bootstrap credentials from the environment.');
  } finally { await disconnectDatabase(); }
};
if (require.main === module) run().catch(() => {
  console.error('Admin bootstrap failed: check strong credentials and ensure no admin/email already exists.');
  process.exitCode = 1;
});
module.exports = run;
