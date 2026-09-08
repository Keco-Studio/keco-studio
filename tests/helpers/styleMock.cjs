module.exports = new Proxy(
  {},
  {
    get: (_target, key) => (typeof key === 'string' ? key : 'style'),
  }
);
