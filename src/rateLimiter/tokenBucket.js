// Token Bucket rate limiter — JS wrapper around the Lua script
const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');
const config = require('../config');

const redis = new Redis(config.redis);
const luaScript = fs.readFileSync(path.join(__dirname, 'tokenBucket.lua'), 'utf8');

// Cache the script SHA for EVALSHA (avoids sending full script text every time)
let scriptSha = null;

async function loadScript() {
  scriptSha = await redis.script('load', luaScript);
}

async function checkLimit(ip) {
  const key = `ratelimit:tokenbucket:${ip}`;
  const now = Date.now();

  try {
    // Load script on first call
    if (!scriptSha) await loadScript();

    let result;
    try {
      result = await redis.evalsha(scriptSha, 1, key, config.rateLimit.capacity, config.rateLimit.refillRate, now);
    } catch (err) {
      if (err.message.includes('NOSCRIPT')) {
        // Script was flushed from Redis cache, reload it
        await loadScript();
        result = await redis.evalsha(scriptSha, 1, key, config.rateLimit.capacity, config.rateLimit.refillRate, now);
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
    // Fail open: if Redis is down, allow the request but log a warning
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
