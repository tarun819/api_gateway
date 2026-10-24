-- src/rateLimiter/tokenBucket.lua

local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local tokens = tonumber(redis.call('HGET', key, 'tokens'))
local lastRefill = tonumber(redis.call('HGET', key, 'lastRefill'))


if tokens == nil then
  tokens = capacity
  lastRefill = now
end


local elapsed = math.max(0, now - lastRefill)
local tokensToAdd = elapsed * refillRate

tokens = math.min(capacity, tokens + tokensToAdd)


lastRefill = now

local allowed = 0

if tokens >= 1 then
 
  tokens = tokens - 1
  allowed = 1
end

redis.call('HSET', key, 'tokens', tokens, 'lastRefill', lastRefill)


local expiry = math.ceil(capacity / refillRate) + 60
redis.call('EXPIRE', key, expiry)


return { allowed, tokens }
