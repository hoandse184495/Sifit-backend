// Express 5 exposes query as an inherited getter. Assignment silently discards
// Zod's parsed values; define an own property so controllers receive them.
module.exports = (req, query) => {
  if (query) {
    Object.defineProperty(req, 'query', {
      value: query,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
};
