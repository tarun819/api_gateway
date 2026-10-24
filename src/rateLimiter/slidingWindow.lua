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

local data = redis.call('HMGET', key, 'prevCount', 'currCount', 'windowStart')

local prevCount   = tonumber(data[1])
local currCount   = tonumber(data[2])
local windowStart = tonumber(data[3])


if windowStart == nil then
  prevCount = 0
  currCount = 0
  windowStart = now
end


local elapsed = now - windowStart

if elapsed >= windowSize * 2 then
 
  prevCount = 0
  currCount = 0
  windowStart = now
elseif elapsed >= windowSize then

  currCount = 0
  windowStart = windowStart + windowSize
end


local elapsedInWindow = now - windowStart
local overlapFraction = 1 - (elapsedInWindow / windowSize)


local weightedCount = prevCount * overlapFraction + currCount


local allowed = 0
local remaining = math.max(0, math.floor(maxRequests - weightedCount))
if weightedCount < maxRequests then
  currCount = currCount + 1
  allowed = 1
  remaining = math.max(0, remaining - 1)
end

redis.call('HSET', key, 'prevCount', prevCount, 'currCount', currCount, 'windowStart', windowStart)


local expiry = math.ceil(windowSize / 1000) * 3 + 60
redis.call('EXPIRE', key, expiry)

return { allowed, remaining }
