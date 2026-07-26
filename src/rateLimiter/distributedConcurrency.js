// src/rateLimiter/distributedConcurrency.js - Self-healing Redis ZSET concurrency limiter
const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');
const config = require('../config');

// 1. Fail-fast Redis client to prevent HTTP socket hangs during Redis outages
const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
});

const scriptPath = path.join(__dirname, 'distributedConcurrency.lua');
const luaScript = fs.readFileSync(scriptPath, 'utf8');

redis.defineCommand('acquireConcurrency', {
  numberOfKeys: 1,
  lua: luaScript,
});

// 2. Attempts atomic slot acquisition via Lua script (fails open on Redis error)
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
    return true; 
  }
}

// 3. Releases concurrency slot when response finishes
async function release(ip, requestId) {
  if (!config.distributedConcurrency.enabled) return;

  const key = `concurrency:${ip}`;
  try {
    await redis.zrem(key, requestId);
  } catch (err) {
    console.error(`[Concurrency Limiter] Redis ZREM error for IP ${ip}:`, err);
  }
}

// 4. Renews lease timestamp for long-running streaming/upload requests
async function renew(ip, requestId) {
  if (!config.distributedConcurrency.enabled) return;

  const key = `concurrency:${ip}`;
  try {
    await redis.zadd(key, Date.now(), requestId);
  } catch (err) {
    console.error(`[Concurrency Limiter] Lease renewal failed for IP ${ip}:`, err);
  }
}

function close() {
  redis.quit();
}

module.exports = { acquire, renew, release, close };
