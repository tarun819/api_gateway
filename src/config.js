// Central configuration for the API gateway
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
    capacity: 10,              // max tokens / max requests per window
    refillRate: 2,             // tokens added per second (token bucket)
    windowSizeMs: 1000,        // window size in ms (sliding window)
  },

  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  },
};

// Allow --port=XXXX from command line for multi-instance testing
const portArg = process.argv.find(arg => arg.startsWith('--port='));
if (portArg) {
  config.gatewayPort = parseInt(portArg.split('=')[1], 10);
}

module.exports = config;
