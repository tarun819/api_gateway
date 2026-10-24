// backends/mock-server.js

const http = require('http');
const config = require('../src/config');

/**
 * Determines which service name a backend port belongs to
 * by looking up the route table in config.
 *
 * @param {number} port - The backend's port number.
 * @returns {string} The service name derived from the route prefix, e.g. 'users'.
 */
function getServiceName(port) {
  for (const [prefix, pool] of Object.entries(config.routes)) {
    if (pool.some(b => b.port === port)) {
      // Extract service name from prefix: '/api/users' → 'users'
      const parts = prefix.split('/').filter(Boolean);
      return parts[parts.length - 1] || 'default';
    }
  }
  return 'unknown';
}

/**
 * Creates and starts a single mock backend server.
 *
 * @param {number} port - The port this backend listens on.
 * @returns {http.Server} The running server instance.
 */
function createBackend(port) {
  // Each backend tracks its own health state independently.
  // Starts healthy (true). Use /toggle-health to flip it.
  let isHealthy = true;
  const serviceName = getServiceName(port);

  const server = http.createServer((req, res) => {
    // Set JSON content type for all responses
    res.setHeader('Content-Type', 'application/json');

    if (req.url === '/health') {
      // Health check endpoint.
      // Returns 200 if healthy, 500 if not.
      // The gateway's health checker will poll this endpoint
      // periodically to decide whether to route traffic here.
      if (isHealthy) {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'healthy', service: serviceName, backend: port }));
      } else {
        res.writeHead(500);
        res.end(JSON.stringify({ status: 'unhealthy', service: serviceName, backend: port }));
      }

    } else if (req.url === '/toggle-health') {
      // Toggle this backend between healthy and unhealthy.
      // This lets us test what happens when a backend goes down
      // without actually crashing the process.
      isHealthy = !isHealthy;
      const newStatus = isHealthy ? 'healthy' : 'unhealthy';
      res.writeHead(200);
      res.end(JSON.stringify({
        service: serviceName,
        backend: port,
        status: newStatus,
        message: `${serviceName}-service on port ${port} is now ${newStatus}`,
      }));
      console.log(`[${serviceName}-service:${port}] Health toggled → ${newStatus}`);

    } else {
      // Service-specific response.
      // When the gateway routes correctly, you'll see the right service name
      // in the response for each URL path.
      res.writeHead(200);
      res.end(JSON.stringify({
        service: serviceName,
        backend: port,
        path: req.url,
        timestamp: new Date().toISOString(),
        message: `Hello from ${serviceName}-service on port ${port}`,
      }));
    }
  });

  server.listen(port, () => {
    console.log(`[${serviceName}-service:${port}] Running on http://localhost:${port}`);
  });

  return server;
}

// Start all backends defined across all routes in config
const servers = config.backends.map(b => createBackend(b.port));

console.log(`\n✅ All ${servers.length} mock backends are running.`);
console.log('   Route → Backend mapping:');
for (const [prefix, pool] of Object.entries(config.routes)) {
  console.log(`     ${prefix.padEnd(20)} → ports [${pool.map(b => b.port).join(', ')}]`);
}
console.log('\n   Test individual backends with:');
console.log('     curl http://localhost:4001/');
console.log('     curl http://localhost:4001/health');
console.log('     curl http://localhost:4001/toggle-health\n');
