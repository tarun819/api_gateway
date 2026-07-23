// src/proxy.js
// Core request forwarding — streams backend responses back to clients using .pipe().

const http = require('http');
const circuitBreaker = require('./circuitBreaker');

function forward(clientReq, clientRes, backend) {
  const options = {
    hostname: backend.host,
    port: backend.port,
    path: clientReq.url,
    method: clientReq.method,
    headers: clientReq.headers,
  };

  const proxyReq = http.request(options, (backendRes) => {
    clientRes.writeHead(backendRes.statusCode, backendRes.headers);

    // Stream backend response body to client with zero memory buffering
    backendRes.pipe(clientRes);

    if (backendRes.statusCode >= 500 && backendRes.statusCode <= 504) {
      circuitBreaker.recordFailure(backend);
    } else if (backendRes.statusCode >= 200 && backendRes.statusCode < 500) {
      circuitBreaker.recordSuccess(backend);
    }
  });

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

  clientReq.pipe(proxyReq);
}

module.exports = { forward };
