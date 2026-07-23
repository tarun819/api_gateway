// src/rateLimiter/slidingWindow.js
// JavaScript wrapper for the Sliding Window Counter Lua script in Redis.

const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');
const config = require('../config');

const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  lazyConnect: false,
});

redis.on('connect', () => {
  console.log(`[SlidingWindow] Connected to Redis at ${config.redis.host}:${config.redis.port}`);
});

redis.on('error', (err) => {
  console.error(`[SlidingWindow] Redis connection error: ${err.message}`);
});

const luaScript = fs.readFileSync(
  path.join(__dirname, 'slidingWindow.lua'),
  'utf-8'
);

redis.defineCommand('slidingWindow', {
  numberOfKeys: 1,
  lua: luaScript,
});

const KEY_PREFIX = 'ratelimit:sw:';

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

async function close() {
  await redis.quit();
  console.log('[SlidingWindow] Redis connection closed');
}

module.exports = { isAllowed, close };
