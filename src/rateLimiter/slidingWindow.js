// src/rateLimiter/slidingWindow.js - Sliding Window Counter rate limiter Redis wrapper
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
  console.log(`[SlidingWindow] Connected to Redis at ${config.redis.host}:${config.redis.port}`);
});

redis.on('error', (err) => {
  console.error(`[SlidingWindow] Redis connection error: ${err.message}`);
});

// 2. Load atomic Sliding Window Lua script
const luaScript = fs.readFileSync(
  path.join(__dirname, 'slidingWindow.lua'),
  'utf-8'
);

redis.defineCommand('slidingWindow', {
  numberOfKeys: 1,
  lua: luaScript,
});

const KEY_PREFIX = 'ratelimit:sw:';

// 3. Evaluates sliding window quota atomically (fails open on Redis error)
async function isAllowed(ip) {
  const key = KEY_PREFIX + ip;
  const now = Date.now();

  try {
    const result = await redis.slidingWindow(
      key,
      config.rateLimit.maxRequests,
      config.rateLimit.windowSizeMs,
      now
    );

    const allowed = result[0] === 1;
    const remaining = result[1];

    return { allowed, remaining };
  } catch (err) {
    console.error(`[SlidingWindow] Redis error, failing open: ${err.message}`);
    return { allowed: true, remaining: -1 };
  }
}

// 4. Graceful connection teardown
async function close() {
  await redis.quit();
  console.log('[SlidingWindow] Redis connection closed');
}

module.exports = { isAllowed, close };
