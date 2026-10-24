// src/server.js
// Entry point for the API gateway.
//
// Pipeline Flow: 
//   Client → Request ID → Metrics Check → Distributed Concurrency → Rate Limiter → Router → Load Balancer + Circuit Breaker → Proxy → Backend
//
// Usage: node src/server.js

const http = require('http');
const crypto = require('crypto');
const config = require('./config');
const proxy = require('./proxy');
const router = require('./router');
const loadBalancer = require('./loadBalancer');
const healthCheck = require('./healthCheck');
const metrics = require('./metrics');
const shutdown = require('./shutdown');
const distributedConcurrency = require('./rateLimiter/distributedConcurrency');

// Pick which rate limiter to use based on config.
// Both modules expose the exact same interface (isAllowed, close),
// so the rest of server.js doesn't need to know which one is active.
const rateLimiter = config.rateLimit.algorithm === 'sliding-window'
  ? require('./rateLimiter/slidingWindow')
  : require('./rateLimiter/tokenBucket');

const server = http.createServer(async (req, res) => {
  // --- Phase 13: Request ID Correlation ---
  // If the client or a previous proxy didn't send an X-Request-Id, generate one.
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  
  // Attach it to the response so the client knows their tracing ID
  res.setHeader('X-Request-Id', requestId);
  // Also ensure it is attached to the request headers so it forwards to the backend
  req.headers['x-request-id'] = requestId;

  // --- Metrics Endpoint ---
  // Intercept GET /metrics BEFORE rate limiting.
  // Why before? Because /metrics is an internal monitoring endpoint —
  // it shouldn't consume a rate-limit token. If we rate-limited it,
  // the dashboard would stop updating when the gateway is under heavy load.
  if (req.url === '/metrics') {
    const snapshot = metrics.getSnapshot(healthCheck.getAllStatuses());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(snapshot, null, 2));  // Pretty-print for human readability
    return;
  }

  // Step 1: Extract the client's IP address.
  // req.socket.remoteAddress gives us the IP of whoever connected to us.
  const clientIp = req.socket.remoteAddress;

  // --- Phase 11b: Distributed Concurrency Limiting ---
  // Check if this IP already has too many active connections open across the cluster.
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

  // --- Lease Renewal for Long-Running Requests ---
  // Refreshes the ZSET score at 70% of leaseTimeout so that long-lived requests
  // (e.g. file uploads, streaming responses) don't get evicted as "stale".
  // If the gateway crashes, the interval stops and ZREMRANGEBYSCORE self-heals.
  const renewalMs = Math.floor(config.distributedConcurrency.leaseTimeoutMs * 0.7);
  const renewalTimer = setInterval(() => {
    distributedConcurrency.renew(clientIp, requestId);
  }, renewalMs);

  // Ensure we stop the renewal timer and release the concurrency slot
  // when the response finishes or the socket closes.
  // The 'close' event is guaranteed to fire exactly once per request.
  res.on('close', () => {
    clearInterval(renewalTimer);
    distributedConcurrency.release(clientIp, requestId);
  });

  // Step 2: Check the rate limiter (Token Bucket or Sliding Window over time)
  // This calls the Lua script inside Redis, which atomically checks and decrements quota.
  const { allowed, remaining } = await rateLimiter.isAllowed(clientIp);

  // Track Redis fallbacks in metrics.
  // remaining === -1 is a signal from the rate limiter that Redis was down
  // and it failed-open (allowed the request through without checking).
  if (remaining === -1) {
    metrics.recordRedisFallback();
  }

  // Always set rate-limit headers so the client knows their current status.
  res.setHeader('X-RateLimit-Limit', config.rateLimit.capacity);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));

  if (!allowed) {
    // The bucket is empty — reject with 429 Too Many Requests.
    metrics.recordBlocked();
    console.log(`[Gateway] [${requestId}] 429 Rate limited ${clientIp} (${remaining} tokens remaining)`);
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfterSeconds: 1 / config.rateLimit.refillRate,
    }));
    return;
  }

  // Step 3: Route — match the request URL to a backend pool.
  // This is the step that makes this an API Gateway, not just a load balancer.
  // Without routing, every URL goes to the same pool of identical backends.
  // With routing, /api/users → user-service pool, /api/orders → order-service pool.
  const route = router.matchRoute(req.url);

  if (!route) {
    console.log(`[Gateway] [${requestId}] 404 No route matched for ${req.url}`);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Not Found',
      message: `No route configured for path: ${req.url}`,
    }));
    return;
  }

  // Step 4: Load balance — pick a healthy backend from the matched pool.
  // Each pool has its own independent round-robin counter.
  const targetBackend = loadBalancer.getNextForPool(route.pool);

  // Handle the case where ALL backends in this route's pool are down or circuit-open.
  if (!targetBackend) {
    console.error(`[Gateway] [${requestId}] 503 Service Unavailable - No healthy backends for route ${route.prefix}`);
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Service Unavailable - All backends down or circuit open' }));
    return;
  }

  // Attach targetBackend to req so proxy.js can read it for Circuit Breaker status recording
  req.targetBackend = targetBackend;

  // Record this request in metrics, tagged with the backend port.
  metrics.recordRequest(targetBackend.port);

  console.log(`[Gateway] ${req.method} ${req.url} → [${route.prefix}] → ${targetBackend.host}:${targetBackend.port} (${remaining} tokens left for ${clientIp})`);

  // Step 5: Forward the request to the chosen backend.
  proxy.forward(req, res, targetBackend);
});

server.listen(config.gatewayPort, () => {
  console.log(`\n🚀 API Gateway running on http://localhost:${config.gatewayPort}`);
  console.log(`   Routes:`);
  for (const [prefix, pool] of Object.entries(config.routes)) {
    console.log(`     ${prefix.padEnd(20)} → backends [${pool.map(b => b.port).join(', ')}]`);
  }
  console.log(`   Total backends: ${config.backends.length} (${config.backends.map(b => b.port).join(', ')})`);
  console.log(`   Rate limiting: ${config.rateLimit.algorithm} (${config.rateLimit.capacity} max, refill ${config.rateLimit.refillRate}/sec)`);
  console.log(`   Metrics:   http://localhost:${config.gatewayPort}/metrics`);

  // Start background health checker AFTER server is listening
  healthCheck.start();

  // Set up graceful shutdown so Ctrl+C doesn't kill in-flight requests.
  shutdown.setup({
    server,
    healthCheck,
    rateLimiter,
    distributedConcurrency
  });

  console.log(`\n   Test with:`);
  console.log(`     curl http://localhost:${config.gatewayPort}/api/users`);
  console.log(`     curl http://localhost:${config.gatewayPort}/api/orders`);
  console.log(`     curl http://localhost:${config.gatewayPort}/api/products\n`);
});
