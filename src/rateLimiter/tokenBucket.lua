-- src/rateLimiter/tokenBucket.lua
-- Atomic token bucket rate limiter — runs inside Redis via EVAL.
-- KEYS[1] = the Redis key for this client's bucket, e.g. "ratelimit:tokenbucket:192.168.1.1"
-- ARGV[1] = bucket capacity (max tokens), e.g. 10
-- ARGV[2] = refill rate (tokens per second), e.g. 2
-- ARGV[3] = current timestamp in seconds (passed from Node, not read from Redis clock)
--
-- Returns: { allowed (0 or 1), remaining tokens }

local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

-- Step 1: Read the current bucket state from the Redis hash.
-- If the key doesn't exist (first request from this IP), tokens and
-- lastRefill will both be nil.
local tokens = tonumber(redis.call('HGET', key, 'tokens'))
local lastRefill = tonumber(redis.call('HGET', key, 'lastRefill'))

-- Step 2: Initialize the bucket if this is the first request from this IP.
-- A new client starts with a full bucket (capacity tokens).
if tokens == nil then
  tokens = capacity
  lastRefill = now
end

-- Step 3: Calculate how many tokens to add based on elapsed time.
-- Example: if 3 seconds passed and refillRate is 2 tokens/sec → add 6 tokens.
-- math.max(0, ...) prevents negative elapsed time (e.g. clock skew).
local elapsed = math.max(0, now - lastRefill)
local tokensToAdd = elapsed * refillRate

-- Step 4: Add the new tokens, but cap at capacity.
-- A bucket can never hold more than its max capacity.
-- math.min ensures we don't exceed the cap.
tokens = math.min(capacity, tokens + tokensToAdd)

-- Update lastRefill to now, since we just did a refill calculation.
lastRefill = now

-- Step 5: Check if the client has at least 1 token to spend.
local allowed = 0

if tokens >= 1 then
  -- Client is allowed through. Consume 1 token.
  tokens = tokens - 1
  allowed = 1
end
-- If tokens < 1, allowed stays 0 → the request will be rejected with 429.

-- Step 6: Write the updated bucket state back to Redis.
-- HSET writes multiple field-value pairs to the hash in one call.
redis.call('HSET', key, 'tokens', tokens, 'lastRefill', lastRefill)

-- Step 7: Set an expiry on the key so idle client buckets don't live forever.
-- If a client stops sending requests, their bucket key will be automatically
-- deleted after (capacity / refillRate + 60) seconds.
-- The +60 gives a generous buffer beyond the time it takes to fully refill.
local expiry = math.ceil(capacity / refillRate) + 60
redis.call('EXPIRE', key, expiry)

-- Return two values:
-- 1. allowed: 1 if the request should proceed, 0 if it should be rejected (429)
-- 2. tokens: the number of tokens remaining after this request (for response headers)
return { allowed, tokens }
