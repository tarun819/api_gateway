-- Token Bucket Rate Limiter (atomic Lua script for Redis)
-- All read-check-write happens in one atomic operation to prevent race conditions.
--
-- KEYS[1] = ratelimit:tokenbucket:<ip>
-- ARGV[1] = capacity (max tokens)
-- ARGV[2] = refillRate (tokens per second)
-- ARGV[3] = now (current timestamp in milliseconds)
--
-- Returns: { allowed (0/1), remaining tokens, retryAfter (seconds) }

local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

-- Read current bucket state, or initialize if new
local tokens = tonumber(redis.call('hget', key, 'tokens'))
local lastRefill = tonumber(redis.call('hget', key, 'lastRefill'))

if tokens == nil then
  -- First request from this IP — start with a full bucket
  tokens = capacity
  lastRefill = now
end

-- Refill tokens based on elapsed time
local elapsed = (now - lastRefill) / 1000 -- convert ms to seconds
local newTokens = elapsed * refillRate
tokens = math.min(capacity, tokens + newTokens)
lastRefill = now

if tokens >= 1 then
  -- Allowed: consume one token
  tokens = tokens - 1
  redis.call('hset', key, 'tokens', tokens, 'lastRefill', lastRefill)
  redis.call('expire', key, capacity / refillRate + 60) -- auto-cleanup inactive IPs

  return { 1, math.floor(tokens), 0 }
else
  -- Rejected: compute how long until 1 token is available
  local retryAfter = (1 - tokens) / refillRate
  redis.call('hset', key, 'tokens', tokens, 'lastRefill', lastRefill)
  redis.call('expire', key, capacity / refillRate + 60)

  return { 0, 0, math.ceil(retryAfter) }
end
