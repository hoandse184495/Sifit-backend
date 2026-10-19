const NotificationPreference = require('../models/notificationPreference.model');

const getOrCreatePreferences = async (user) => {
  let preferences = await NotificationPreference.findOne({ userId: user._id });
  if (!preferences) {
    preferences = await NotificationPreference.create({ userId: user._id });
  }
  return preferences;
};

const updatePreferences = async (user, data) =>
  NotificationPreference.findOneAndUpdate(
    { userId: user._id },
    { $set: data },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

module.exports = { getOrCreatePreferences, updatePreferences };
