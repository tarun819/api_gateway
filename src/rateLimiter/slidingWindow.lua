-- src/rateLimiter/slidingWindow.lua
-- Atomic sliding window counter rate limiter — runs inside Redis via EVAL.
-- KEYS[1] = the Redis key for this client's window state, e.g. "ratelimit:sw:192.168.1.1"
-- ARGV[1] = max requests allowed per window, e.g. 10
-- ARGV[2] = window size in milliseconds, e.g. 1000 (1 second)
-- ARGV[3] = current timestamp in milliseconds (passed from Node)
--
-- Returns: { allowed (0 or 1), remaining requests }

local key = KEYS[1]
local maxRequests = tonumber(ARGV[1])
local windowSize = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

-- Step 1: Read the current window state from the Redis hash.
-- We track three values:
--   prevCount:   how many requests were in the previous window
--   currCount:   how many requests are in the current window
--   windowStart: when the current window began (timestamp in ms)
-- If the key doesn't exist (first request from this IP), all will be nil.
-- Fetch all three fields in a SINGLE Redis call
local data = redis.call('HMGET', key, 'prevCount', 'currCount', 'windowStart')

local prevCount   = tonumber(data[1])
local currCount   = tonumber(data[2])
local windowStart = tonumber(data[3])


-- Step 2: Initialize if this is the first request from this IP.
if windowStart == nil then
  prevCount = 0
  currCount = 0
  windowStart = now
end

-- Step 3: Check if we've moved into a new time window.
-- Time flows forward: eventually the current window ends and becomes
-- the "previous" window, and a fresh window starts.
local elapsed = now - windowStart

if elapsed >= windowSize * 2 then
  -- Two or more full windows have passed since the last request.
  -- Both the previous and current windows are completely stale → reset everything.
  -- This happens when a client goes quiet for a while and comes back.
  prevCount = 0
  currCount = 0
  windowStart = now
elseif elapsed >= windowSize then
  -- We've moved into the next window.
  -- The old "current" window becomes the new "previous" window.
  -- A fresh "current" window starts with 0 requests.
  prevCount = currCount
  currCount = 0
  windowStart = windowStart + windowSize
end

-- Step 4: Calculate the weighted request count using the sliding window formula.
--
-- The key insight: instead of counting requests in a fixed window (which would
-- allow bursts at window boundaries), we BLEND the previous window's count
-- with the current window's count based on how much the previous window
-- still overlaps with our sliding window.
--
-- Example: window = 1 second, we're at 700ms into the current window.
--   Previous window had 42 requests.
--   Current window has 18 requests so far.
--   Overlap fraction = 1 - (700 / 1000) = 0.30 (30% of prev window is still relevant)
--   Weighted count = 42 × 0.30 + 18 = 12.6 + 18 = 30.6
--
-- This smooths out the rate enforcement and prevents boundary bursts.
local elapsedInWindow = now - windowStart
local overlapFraction = 1 - (elapsedInWindow / windowSize)

-- -- math.max prevents negative overlap (shouldn't happen, but defensive coding)
-- overlapFraction = math.max(0, overlapFraction)

local weightedCount = prevCount * overlapFraction + currCount

-- Step 5: Decide whether to allow or reject the request.
local allowed = 0
local remaining = math.max(0, math.floor(maxRequests - weightedCount))
if weightedCount < maxRequests then
  currCount = currCount + 1
  allowed = 1
  remaining = math.max(0, remaining - 1)
end
-- If weightedCount >= maxRequests, allowed stays 0 → rejected with 429.

-- Step 6: Write the updated state back to Redis.
redis.call('HSET', key, 'prevCount', prevCount, 'currCount', currCount, 'windowStart', windowStart)

-- Step 7: Set an expiry so idle client keys don't live forever.
-- We keep the key alive for 3 window durations — enough to cover the
-- previous window, current window, and a buffer.
local expiry = math.ceil(windowSize / 1000) * 3 + 60
redis.call('EXPIRE', key, expiry)

-- Return two values (same interface as tokenBucket.lua):
-- 1. allowed: 1 if the request should proceed, 0 if rejected (429)
-- 2. remaining: how many more requests the client can make in this window
return { allowed, remaining }
