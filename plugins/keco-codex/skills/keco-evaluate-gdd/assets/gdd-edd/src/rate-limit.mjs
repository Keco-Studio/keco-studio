export function createRateLimiter({ limit = 30, windowMs = 60_000 } = {}) {
  const buckets = new Map();
  return {
    allow(key) {
      const now = Date.now();
      const current = buckets.get(key);
      if (!current || current.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      current.count += 1;
      return current.count <= limit;
    },
  };
}
