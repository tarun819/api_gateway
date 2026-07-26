// src/rateLimiter/tokenBucket.js - Token Bucket rate limiter Redis wrapper
const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');
const config = require('../config');

// 1. Fail-fast Redis connection setup
const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  lazyConnect: false,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
});

redis.on('connect', () => {
  console.log(`[RateLimiter] Connected to Redis at ${config.redis.host}:${config.redis.port}`);
});

redis.on('error', (err) => {
  console.error(`[RateLimiter] Redis connection error: ${err.message}`);
});

// 2. Load atomic Token Bucket Lua script
const luaScript = fs.readFileSync(
  path.join(__dirname, 'tokenBucket.lua'),
  'utf-8'
);

redis.defineCommand('tokenBucket', {
  numberOfKeys: 1,
  lua: luaScript,
});

const KEY_PREFIX = 'ratelimit:tokenbucket:';

// 3. Evaluates token quota atomically (fails open on Redis error)
async function isAllowed(ip) {
  const key = KEY_PREFIX + ip;
  const now = Date.now() / 1000;

  try {
    const result = await redis.tokenBucket(
      key,
      config.rateLimit.capacity,
      config.rateLimit.refillRate,
      now
    );

    const allowed = result[0] === 1;
    const remaining = result[1];

    return { allowed, remaining };
  } catch (err) {
    console.error(`[RateLimiter] Redis error, failing open: ${err.message}`);
    return { allowed: true, remaining: -1 };
  }
}

// 4. Graceful connection teardown
async function close() {
  await redis.quit();
  console.log('[RateLimiter] Redis connection closed');
}

module.exports = { isAllowed, close };
