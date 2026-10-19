const crypto = require('crypto');

const canonicalize = (value) => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
      }, {});
  }

  return value;
};

const createRequestFingerprint = (payload) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(payload)))
    .digest('hex');

module.exports = {
  createRequestFingerprint,
};
