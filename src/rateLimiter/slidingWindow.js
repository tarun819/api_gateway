// Sliding Window Counter rate limiter — JS wrapper around the Lua script
const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');
const config = require('../config');

const redis = new Redis(config.redis);
const luaScript = fs.readFileSync(path.join(__dirname, 'slidingWindow.lua'), 'utf8');

let scriptSha = null;

async function loadScript() {
  scriptSha = await redis.script('load', luaScript);
}

async function checkLimit(ip) {
  const key = `ratelimit:sw:${ip}`;
  const now = Date.now();

  try {
    if (!scriptSha) await loadScript();

    let result;
    try {
      result = await redis.evalsha(scriptSha, 1, key, config.rateLimit.capacity, config.rateLimit.windowSizeMs, now);
    } catch (err) {
      if (err.message.includes('NOSCRIPT')) {
        await loadScript();
        result = await redis.evalsha(scriptSha, 1, key, config.rateLimit.capacity, config.rateLimit.windowSizeMs, now);
      } else {
        throw err;
      }
    }

    return {
      allowed: result[0] === 1,
      remaining: result[1],
      retryAfter: result[2],
      limit: config.rateLimit.capacity,
      fallback: false,
    };
  } catch (err) {
    // Fail open: if Redis is down, allow the request
    console.error(`[RateLimit] Redis error, failing open: ${err.message}`);
    return {
      allowed: true,
      remaining: -1,
      retryAfter: 0,
      limit: config.rateLimit.capacity,
      fallback: true,
    };
  }
}

function getRedisClient() {
  return redis;
}

module.exports = { checkLimit, getRedisClient };
