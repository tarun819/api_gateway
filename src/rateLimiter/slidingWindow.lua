-- Sliding Window Counter Rate Limiter (atomic Lua script for Redis)
-- Weights the previous window's count by its overlap with the current sliding window.
--
-- KEYS[1] = ratelimit:sw:<ip>
-- ARGV[1] = maxRequests (max allowed per window)
-- ARGV[2] = windowSizeMs (window size in milliseconds)
-- ARGV[3] = now (current timestamp in milliseconds)
--
-- Returns: { allowed (0/1), remaining, retryAfter (seconds) }

local key = KEYS[1]
local maxRequests = tonumber(ARGV[1])
local windowSize = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

-- Read stored state
local prevCount = tonumber(redis.call('hget', key, 'prevCount')) or 0
local currCount = tonumber(redis.call('hget', key, 'currCount')) or 0
local windowStart = tonumber(redis.call('hget', key, 'windowStart')) or now

-- Check if we've moved into a new window
local elapsed = now - windowStart

if elapsed >= windowSize * 2 then
  -- Two full windows have passed — reset everything
  prevCount = 0
  currCount = 0
  windowStart = now
elseif elapsed >= windowSize then
  -- Moved to next window — current becomes previous
  prevCount = currCount
  currCount = 0
  windowStart = windowStart + windowSize
end

-- Calculate weighted request count using sliding window formula
local elapsedInWindow = now - windowStart
local overlapFraction = 1 - (elapsedInWindow / windowSize)
local weightedCount = prevCount * overlapFraction + currCount

if weightedCount < maxRequests then
  -- Allowed
  currCount = currCount + 1
  redis.call('hset', key, 'prevCount', prevCount, 'currCount', currCount, 'windowStart', windowStart)
  redis.call('expire', key, math.ceil(windowSize / 1000) * 3)

  local remaining = math.floor(maxRequests - (prevCount * overlapFraction + currCount))
  return { 1, math.max(0, remaining), 0 }
else
  -- Rejected
  redis.call('hset', key, 'prevCount', prevCount, 'currCount', currCount, 'windowStart', windowStart)
  redis.call('expire', key, math.ceil(windowSize / 1000) * 3)

  -- Retry after the current window ends
  local retryAfter = math.ceil((windowSize - elapsedInWindow) / 1000)
  return { 0, 0, math.max(1, retryAfter) }
end
