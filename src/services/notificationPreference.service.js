const NotificationPreference = require('../models/notificationPreference.model');

const getOrCreatePreferences = async (user) => {
  try {
    return await NotificationPreference.findOneAndUpdate(
      { userId: user._id },
      { $setOnInsert: { userId: user._id } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    if (error.code === 11000) return NotificationPreference.findOne({ userId: user._id });
    throw error;
  }
};

const updatePreferences = async (user, data) =>
  NotificationPreference.findOneAndUpdate(
    { userId: user._id },
    { $set: data },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

module.exports = { getOrCreatePreferences, updatePreferences };
