// src/proxy.js - Low-level streaming reverse proxy
const http = require('http');
const circuitBreaker = require('./circuitBreaker');

function forward(clientReq, clientRes, backend) {
  // 1. Build outgoing HTTP request options with fast-fail connection timeout
  const options = {
    hostname: backend.host,
    port: backend.port,
    path: clientReq.url,
    method: clientReq.method,
    headers: clientReq.headers,
    timeout: 2000,
  };

  // 2. Dispatch request and stream backend response back to client
  const proxyReq = http.request(options, (backendRes) => {
    clientRes.writeHead(backendRes.statusCode, backendRes.headers);
    backendRes.pipe(clientRes);

    if (backendRes.statusCode >= 500 && backendRes.statusCode <= 504) {
      circuitBreaker.recordFailure(backend);
    } else if (backendRes.statusCode >= 200 && backendRes.statusCode < 500) {
      circuitBreaker.recordSuccess(backend);
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy(new Error('Backend connection timeout'));
  });

  // 3. Handle connection errors & fail fast with 502 Bad Gateway
  proxyReq.on('error', (err) => {
    circuitBreaker.recordFailure(backend);
    console.error(`[Proxy] Error forwarding to ${backend.host}:${backend.port} → ${err.message}`);

    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'Content-Type': 'application/json' });
      clientRes.end(JSON.stringify({
        error: 'Bad Gateway',
        message: `Backend ${backend.host}:${backend.port} is unreachable`,
      }));
    }
  });

  // 4. Stream client request body & manually trigger end if request completed during async gap
  clientReq.pipe(proxyReq);
  if (clientReq.complete) {
    proxyReq.end();
  }
}

module.exports = { forward };
