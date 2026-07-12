// Mock backend servers for testing
const http = require('http');
const config = require('../src/config');

function createBackend(port) {
  let isHealthy = true;

  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');

    if (req.url === '/health') {
      const status = isHealthy ? 200 : 500;
      res.writeHead(status);
      res.end(JSON.stringify({ status: isHealthy ? 'healthy' : 'unhealthy', backend: port }));
    } else if (req.url === '/toggle-health') {
      isHealthy = !isHealthy;
      res.writeHead(200);
      res.end(JSON.stringify({
        backend: port,
        status: isHealthy ? 'healthy' : 'unhealthy',
        message: `Backend ${port} is now ${isHealthy ? 'healthy' : 'unhealthy'}`,
      }));
      console.log(`[Backend ${port}] Health toggled → ${isHealthy ? 'healthy' : 'unhealthy'}`);
    } else {
      res.writeHead(200);
      res.end(JSON.stringify({
        backend: port,
        timestamp: new Date().toISOString(),
        message: `Hello from backend ${port}`,
      }));
    }
  });

  server.listen(port, () => {
    console.log(`[Backend ${port}] Running on http://localhost:${port}`);
  });

  return server;
}

config.backends.forEach(b => createBackend(b.port));
console.log(`\n✅ All ${config.backends.length} mock backends running.\n`);
