// src/rateLimiter/distributedConcurrency.js
// Node.js wrapper for Redis ZSET-backed distributed concurrency limiter.

const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');
const config = require('../config');

const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
});

const scriptPath = path.join(__dirname, 'distributedConcurrency.lua');
const luaScript = fs.readFileSync(scriptPath, 'utf8');

redis.defineCommand('acquireConcurrency', {
  numberOfKeys: 1,
  lua: luaScript,
});

async function acquire(ip, requestId) {
  if (!config.distributedConcurrency.enabled) return true;

  const key = `concurrency:${ip}`;
  const currentTime = Date.now();
  const leaseTimeout = config.distributedConcurrency.leaseTimeoutMs;
  const maxConcurrent = config.distributedConcurrency.maxConcurrent;

  try {
    const result = await redis.acquireConcurrency(
      key,
      currentTime,
      leaseTimeout,
      maxConcurrent,
      requestId
    );
    return result === 1;
  } catch (err) {
    console.error(`[Concurrency Limiter] Redis error for IP ${ip}:`, err);
    // Fail-open strategy on Redis downtime
    return true; 
  }
}

async function release(ip, requestId) {
  if (!config.distributedConcurrency.enabled) return;

  const key = `concurrency:${ip}`;
  try {
    await redis.zrem(key, requestId);
  } catch (err) {
    console.error(`[Concurrency Limiter] Redis ZREM error for IP ${ip}:`, err);
  }
}

function close() {
  redis.quit();
}

module.exports = { acquire, release, close };
