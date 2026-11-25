class RateLimiter {
  constructor({ limit, windowMs }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
    setInterval(() => this.prune(), windowMs).unref();
  }

  recent(key) {
    const since = Date.now() - this.windowMs;
    const hits = (this.hits.get(key) || []).filter((time) => time > since);
    if (hits.length) this.hits.set(key, hits);
    else this.hits.delete(key);
    return hits;
  }

  retryAfter(key) {
    const hits = this.recent(key);
    if (hits.length < this.limit) return 0;
    return Math.ceil((hits[hits.length - this.limit] + this.windowMs - Date.now()) / 1000);
  }

  hit(key) {
    const hits = this.recent(key);
    hits.push(Date.now());
    this.hits.set(key, hits);
  }

  reset(key) {
    this.hits.delete(key);
  }

  prune() {
    for (const key of this.hits.keys()) this.recent(key);
  }
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;

module.exports = {
  loginByAccount: new RateLimiter({ limit: 5, windowMs: FIFTEEN_MINUTES }),
  loginByIp: new RateLimiter({ limit: 20, windowMs: FIFTEEN_MINUTES }),
  registerByIp: new RateLimiter({ limit: 10, windowMs: FIFTEEN_MINUTES }),
  mfaByIp: new RateLimiter({ limit: 20, windowMs: FIFTEEN_MINUTES }),
};
