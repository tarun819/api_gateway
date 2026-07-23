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

-- Step 1: Remove expired requests (Self-Healing)
-- Any request older than (currentTime - leaseTimeout) is considered crashed/orphaned.
local cutoffTime = currentTime - leaseTimeout
redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoffTime)

-- Step 2: Count how many active requests remain
local activeRequests = redis.call('ZCARD', key)

-- Step 3: Check if adding one more would exceed the limit
if activeRequests >= maxConcurrent then
    return 0 -- Reject (Too Many Requests)
end

-- Step 4: Accept the request
-- Add the new request ID with the current timestamp as its score
redis.call('ZADD', key, currentTime, requestId)

-- Step 5: Housekeeping
-- Set an absolute expiration on the entire key so we don't leak memory 
-- for IPs that never make another request.
redis.call('PEXPIRE', key, leaseTimeout * 2)

return 1 -- Success
