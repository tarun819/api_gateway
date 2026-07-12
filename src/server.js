// API Gateway — main entry point
// Wires together: load balancer, rate limiter, health checks, metrics, and proxy
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const proxy = require('./proxy');
const loadBalancer = require('./loadBalancer');
const healthCheck = require('./healthCheck');
const metrics = require('./metrics');
const shutdown = require('./shutdown');

// Pick rate limiter based on config
const rateLimiter = config.rateLimit.algorithm === 'sliding-window'
  ? require('./rateLimiter/slidingWindow')
  : require('./rateLimiter/tokenBucket');

// Extract client IP, handling IPv6-mapped IPv4 addresses
function getClientIp(req) {
  const ip = req.socket.remoteAddress || '0.0.0.0';
  return ip.replace(/^::ffff:/, '');
}

// Set rate limit headers on a response
function setRateLimitHeaders(res, result) {
  res.setHeader('X-RateLimit-Limit', result.limit);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, result.remaining));
  if (result.retryAfter > 0) {
    res.setHeader('Retry-After', result.retryAfter);
  }
}

const server = http.createServer(async (req, res) => {
  shutdown.trackRequest();
  res.on('finish', () => shutdown.untrackRequest());

  // Serve dashboard
  if (req.url === '/dashboard') {
    const dashboardPath = path.join(__dirname, 'dashboard.html');
    const html = fs.readFileSync(dashboardPath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }

  // Serve metrics
  if (req.url === '/metrics') {
    const snapshot = metrics.getSnapshot(healthCheck.getAllStatus());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(snapshot, null, 2));
    return;
  }

  // Rate limiting
  const clientIp = getClientIp(req);
  const result = await rateLimiter.checkLimit(clientIp);

  if (result.fallback) {
    metrics.recordRedisFallback();
  }

  if (!result.allowed) {
    metrics.recordBlocked();
    setRateLimitHeaders(res, result);
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Too Many Requests',
      retryAfter: result.retryAfter,
    }));
    return;
  }

  // Load balancing
  const backend = loadBalancer.getNext();

  if (!backend) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Service Unavailable',
      message: 'All backend servers are down',
    }));
    return;
  }

  metrics.recordRequest(backend.port);
  setRateLimitHeaders(res, result);

  console.log(`[Gateway] ${req.method} ${req.url} → ${backend.port} (${clientIp})`);
  proxy.forward(req, res, backend);
});

// Start everything
healthCheck.start();
shutdown.register(server, healthCheck, rateLimiter.getRedisClient());

server.listen(config.gatewayPort, () => {
  console.log(`\n🚀 API Gateway running on http://localhost:${config.gatewayPort}`);
  console.log(`   Algorithm: ${config.rateLimit.algorithm}`);
  console.log(`   Backends: ${config.backends.map(b => b.port).join(', ')}`);
  console.log(`   Dashboard: http://localhost:${config.gatewayPort}/dashboard`);
  console.log(`   Metrics:   http://localhost:${config.gatewayPort}/metrics\n`);
});
