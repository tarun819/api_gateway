// src/server.js
// Entry point for the API Gateway — handles pipeline routing, limits, and proxying.

const http = require('http');
const crypto = require('crypto');
const config = require('./config');
const proxy = require('./proxy');
const loadBalancer = require('./loadBalancer');
const healthCheck = require('./healthCheck');
const metrics = require('./metrics');
const shutdown = require('./shutdown');
const distributedConcurrency = require('./rateLimiter/distributedConcurrency');

const rateLimiter = config.rateLimit.algorithm === 'sliding-window'
  ? require('./rateLimiter/slidingWindow')
  : require('./rateLimiter/tokenBucket');

const server = http.createServer(async (req, res) => {
  // 1. Request ID Correlation
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', requestId);
  req.headers['x-request-id'] = requestId;

  // 2. Metrics Endpoint (intercepted before rate limiting)
  if (req.url === '/metrics') {
    const snapshot = metrics.getSnapshot(healthCheck.getAllStatuses());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(snapshot, null, 2));
    return;
  }

  const clientIp = req.socket.remoteAddress;

  // 3. Distributed Concurrency Check
  const canProceed = await distributedConcurrency.acquire(clientIp, requestId);
  if (!canProceed) {
    metrics.recordBlocked();
    console.log(`[Gateway] [${requestId}] 429 Concurrency limit exceeded for ${clientIp}`);
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Too Many Requests',
      message: 'Too many concurrent connections. Please wait for existing requests to finish.',
    }));
    return;
  }

  res.on('close', () => {
    distributedConcurrency.release(clientIp, requestId);
  });

  // 4. Rate Limiting Check (Token Bucket / Sliding Window)
  const { allowed, remaining } = await rateLimiter.isAllowed(clientIp);

  if (remaining === -1) {
    metrics.recordRedisFallback();
  }

  res.setHeader('X-RateLimit-Limit', config.rateLimit.capacity);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));

  if (!allowed) {
    metrics.recordBlocked();
    console.log(`[Gateway] 429 Rate limited ${clientIp} (${remaining} tokens remaining)`);
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfterSeconds: 1 / config.rateLimit.refillRate,
    }));
    return;
  }

  // 5. Load Balancing & Reverse Proxying
  const targetBackend = loadBalancer.getNextBackend();

  if (!targetBackend) {
    console.error(`[Gateway] [${requestId}] 503 Service Unavailable - No healthy backends available!`);
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Service Unavailable - All backends down or circuit open' }));
    return;
  }

  req.targetBackend = targetBackend;
  metrics.recordRequest(targetBackend.port);

  console.log(`[Gateway] ${req.method} ${req.url} → ${targetBackend.host}:${targetBackend.port} (${remaining} tokens left for ${clientIp})`);

  proxy.forward(req, res, targetBackend);
});

server.listen(config.gatewayPort, () => {
  console.log(`\n🚀 API Gateway running on http://localhost:${config.gatewayPort}`);
  console.log(`   Load balancing across ${config.backends.length} backends: ${config.backends.map(b => b.port).join(', ')}`);
  console.log(`   Rate limiting: ${config.rateLimit.algorithm} (${config.rateLimit.capacity} max, refill ${config.rateLimit.refillRate}/sec)`);
  console.log(`   Metrics:   http://localhost:${config.gatewayPort}/metrics`);

  healthCheck.start();
  shutdown.setup({
    server,
    healthCheck,
    rateLimiter,
    distributedConcurrency
  });

  console.log(`\n   Test with: curl.exe http://localhost:${config.gatewayPort}/\n`);
});
