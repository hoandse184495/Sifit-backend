const mongoose = require('mongoose');
module.exports = async (action) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await action(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};
