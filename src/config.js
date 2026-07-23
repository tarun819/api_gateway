// src/config.js
// Central configuration for gateway port, backends, rate limiting, and circuit breaker.

const config = {
  gatewayPort: parseInt(process.env.GATEWAY_PORT, 10) || 8080,

  backends: [
    { host: '127.0.0.1', port: 4001 },
    { host: '127.0.0.1', port: 4002 },
    { host: '127.0.0.1', port: 4003 },
  ],

  healthCheck: {
    intervalMs: 3000,
    timeoutMs: 2000,
    path: '/health',
  },

  rateLimit: {
    algorithm: 'token-bucket', // 'token-bucket' or 'sliding-window'
    capacity: 10,
    refillRate: 2,
    windowSizeMs: 1000,
    maxRequests: 10,
  },

  redis: {
    host: '127.0.0.1',
    port: 6379,
  },

  distributedConcurrency: {
    enabled: true,
    maxConcurrent: 5,
    leaseTimeoutMs: 30000,
  },

  circuitBreaker: {
    failureThreshold: 5,
    cooldownMs: 10000,
  },
};

// Override gateway port via --port=XXXX argument
const portArg = process.argv.find(arg => arg.startsWith('--port='));
if (portArg) {
  config.gatewayPort = parseInt(portArg.split('=')[1], 10);
}

module.exports = config;
