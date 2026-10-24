-- src/rateLimiter/distributedConcurrency.lua
-- KEYS[1] = concurrency:{ip}
-- ARGV[1] = currentTime (ms)
-- ARGV[2] = leaseTimeout (ms)
-- ARGV[3] = maxConcurrent
-- ARGV[4] = requestId

local key = KEYS[1]
local currentTime = tonumber(ARGV[1])
local leaseTimeout = tonumber(ARGV[2])
local maxConcurrent = tonumber(ARGV[3])
local requestId = ARGV[4]


local cutoffTime = currentTime - leaseTimeout
redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoffTime)


local activeRequests = redis.call('ZCARD', key)

if activeRequests >= maxConcurrent then
    return 0 
end


redis.call('ZADD', key, currentTime, requestId)


redis.call('PEXPIRE', key, leaseTimeout * 2)

return 1 
