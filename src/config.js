// src/config.js
// Central configuration — every tunable value lives here.
// Override any value with environment variables if needed.

const config = {
  // The port the API gateway listens on.
  // Can be overridden via command line: node src/server.js --port=8081
  gatewayPort: parseInt(process.env.GATEWAY_PORT, 10) || 8080,

  // List of backend servers the gateway will load-balance across.
  // Each entry is { host, port } — all on localhost for development.
  backends: [
    { host: '127.0.0.1', port: 4001 },
    { host: '127.0.0.1', port: 4002 },
    { host: '127.0.0.1', port: 4003 },
  ],

  // Health check settings
  healthCheck: {
    intervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL, 10) || 3000,       // How often to ping each backend's /health
    timeoutMs: 2000,        // How long to wait for a health response before marking "down"
    path: '/health',        // The endpoint to ping on each backend
  },

  // Rate limiter settings
  rateLimit: {
    algorithm: 'token-bucket',  // 'token-bucket' or 'sliding-window'
    capacity: 10,               // Max tokens in the bucket (max burst size)
    refillRate: 2,              // Tokens added per second
    windowSizeMs: 1000,         // Window size for sliding window algorithm (1 second)
    maxRequests: 10,            // Max requests per window for sliding window
  },

  // Redis connection settings
  redis: {
    host: '127.0.0.1',
    port: 6379,
  },

  // Distributed Concurrency settings (Phase 11b)
  distributedConcurrency: {
    enabled: true,
    maxConcurrent: 5,       // Max simultaneous in-flight requests per IP
    leaseTimeoutMs: 30000,  // Assume any request taking longer than 30s has crashed
  },

  // Circuit Breaker settings (Phase 12 — Sliding Window)
  circuitBreaker: {
    windowSize: 20,              // Track the last 20 request outcomes (ring buffer, pre-filled with successes)
    failureRateThreshold: 0.5,   // Trip OPEN when failure rate exceeds 50%
    cooldownMs: parseInt(process.env.CIRCUIT_COOLDOWN_MS, 10) || 10000, // Time to wait in OPEN state before transitioning to HALF_OPEN
  },
};

// Allow overriding gateway port via --port=XXXX command-line argument
// This is how we run two instances on different ports for the distributed test.
const portArg = process.argv.find(arg => arg.startsWith('--port='));
if (portArg) {
  config.gatewayPort = parseInt(portArg.split('=')[1], 10);
}

module.exports = config;
