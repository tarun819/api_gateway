// backends/mock-server.js
// Spins up 3 tiny HTTP servers that pretend to be real backend services.
// Each one responds to:
//   GET /           → { backend: <port>, timestamp: <now> }
//   GET /health     → 200 OK if healthy, 500 if toggled down
//   GET /toggle-health → flips the health state, returns new status
//
// Usage: node backends/mock-server.js

const http = require('http');
const config = require('../src/config');

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

  const server = http.createServer((req, res) => {
    // Set JSON content type for all responses
    res.setHeader('Content-Type', 'application/json');

    if (req.url === '/health') {
      // Health check endpoint.
      // Returns 200 if healthy, 500 if not.
      // The gateway's health checker (Phase 4) will poll this endpoint
      // periodically to decide whether to route traffic here.
      if (isHealthy) {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'healthy', backend: port }));
      } else {
        res.writeHead(500);
        res.end(JSON.stringify({ status: 'unhealthy', backend: port }));
      }

    } else if (req.url === '/toggle-health') {
      // Toggle this backend between healthy and unhealthy.
      // This lets us test what happens when a backend goes down
      // without actually crashing the process.
      isHealthy = !isHealthy;
      const newStatus = isHealthy ? 'healthy' : 'unhealthy';
      res.writeHead(200);
      res.end(JSON.stringify({
        backend: port,
        status: newStatus,
        message: `Backend ${port} is now ${newStatus}`,
      }));
      console.log(`[Backend ${port}] Health toggled → ${newStatus}`);

    } else {
      // Default route: respond with which backend handled the request.
      // When the gateway is load-balancing, you'll see different port
      // numbers in the response as it cycles through backends.
      res.writeHead(200);
      res.end(JSON.stringify({
        backend: port,
        timestamp: new Date().toISOString(),
        message: `Hello from backend ${port}`,
      }));
    }
  });

  server.listen(port, () => {
    console.log(`[Backend ${port}] Mock server running on http://localhost:${port}`);
  });

  return server;
}

// Start all three backends defined in config
const servers = config.backends.map(b => createBackend(b.port));

console.log(`\n✅ All ${servers.length} mock backends are running.`);
console.log('   Test with:');
console.log('     curl http://localhost:4001/');
console.log('     curl http://localhost:4001/health');
console.log('     curl http://localhost:4001/toggle-health');
console.log('     curl http://localhost:4001/health   (should now return 500)\n');
