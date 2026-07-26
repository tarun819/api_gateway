// src/proxy.js
// Core request forwarding — the heart of the gateway.
//
// Takes an incoming client request, forwards it to a backend server,
// and STREAMS the backend's response back to the client.
//
// Key concept: we use .pipe() instead of buffering. This means the
// gateway's memory usage stays constant regardless of response size.
// A 1KB response and a 500MB response use the same amount of RAM.

const http = require('http');
const circuitBreaker = require('./circuitBreaker');

/**
 * Forwards a client request to a backend server and streams the response back.
 *
 * @param {http.IncomingMessage} clientReq - The original request from the client.
 * @param {http.ServerResponse} clientRes - The response object to send back to the client.
 * @param {object} backend - The backend to forward to, e.g. { host: '127.0.0.1', port: 4001 }.
 */
function forward(clientReq, clientRes, backend) {
  // Build the options for the outgoing request to the backend.
  // We copy the client's method, path, and headers so the backend
  // sees the exact same request the client originally sent.
  const options = {
    hostname: backend.host,
    port: backend.port,
    path: clientReq.url,       // Forward the same URL path (e.g. /, /health)
    method: clientReq.method,  // Forward the same HTTP method (GET, POST, etc.)
    headers: clientReq.headers, // Forward the same headers
    timeout: 2000,              // Timeout after 2s if backend doesn't respond
  };

  // Create the outgoing request to the backend server.
  // The callback fires when the backend starts sending its response.
  const proxyReq = http.request(options, (backendRes) => {
    delete backendRes.headers['x-ratelimit-limit'];
    delete backendRes.headers['x-ratelimit-remaining'];
    delete backendRes.headers['x-request-id'];

    // Copy the backend's status code to our response to the client.
    clientRes.writeHead(backendRes.statusCode, backendRes.headers);

    backendRes.on('error', (err) => {
      console.error(`[Proxy] Backend response stream error: ${err.message}`);
      clientRes.destroy(err);
    });
    backendRes.on('aborted', () => {
      console.error('[Proxy] Backend response aborted mid-stream');
      clientRes.destroy(new Error('Backend aborted connection'));
    });

    // STREAM the backend's response body directly to the client via .pipe()
    backendRes.pipe(clientRes);

    // Record success/failure based on HTTP status codes per Phase 12 spec
    if (backendRes.statusCode >= 500 && backendRes.statusCode <= 504) {
      circuitBreaker.recordFailure(backend);
    } else if (backendRes.statusCode >= 200 && backendRes.statusCode < 500) {
      circuitBreaker.recordSuccess(backend);
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy(new Error('Backend connection timeout'));
  });

  // Handle connection errors — e.g. backend is down, unreachable, or times out.
  proxyReq.on('error', (err) => {
    circuitBreaker.recordFailure(backend);
    console.error(`[Proxy] Error forwarding to ${backend.host}:${backend.port} → ${err.message}`);

    // Send 502 Bad Gateway to the client.
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'Content-Type': 'application/json' });
      clientRes.end(JSON.stringify({
        error: 'Bad Gateway',
        message: `Backend ${backend.host}:${backend.port} is unreachable`,
      }));
    }
  });

  // Stream the client's request body to the backend (for POST/PUT requests)
  clientReq.pipe(proxyReq);

  // If the client request has already finished (e.g. a GET request with no body)
  // before we started piping (due to async delays like rate limiting), we must
  // manually end the outgoing proxy request. Otherwise, it hangs indefinitely.
  if (clientReq.complete) {
    proxyReq.end();
  }
}

module.exports = { forward };
