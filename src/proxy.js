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


function forward(clientReq, clientRes, backend) {

  const options = {
    hostname: backend.host,
    port: backend.port,
    path: clientReq.url,
    method: clientReq.method,
    headers: clientReq.headers,
    timeout: 2000,
  };

  const proxyReq = http.request(options, (backendRes) => {
    delete backendRes.headers['x-ratelimit-limit'];
    delete backendRes.headers['x-ratelimit-remaining'];
    delete backendRes.headers['x-request-id'];

    clientRes.writeHead(backendRes.statusCode, backendRes.headers);

    let recorded = false;


    backendRes.on('error', (err) => {
      console.error(`[Proxy] Backend response stream error: ${err.message}`);
      if (!recorded) {
        recorded = true;
        circuitBreaker.recordFailure(backend);
      }
      clientRes.destroy(err);
    });


    backendRes.on('aborted', () => {
      console.error('[Proxy] Backend response aborted mid-stream');
      if (!recorded) {
        recorded = true;
        circuitBreaker.recordFailure(backend);
      }
      clientRes.destroy(new Error('Backend aborted connection'));
    });

    backendRes.pipe(clientRes);


    backendRes.on('end', () => {
      if (recorded) return;
      recorded = true;

      if (backendRes.statusCode >= 500 && backendRes.statusCode <= 504) {
        circuitBreaker.recordFailure(backend);
      } else if (backendRes.statusCode >= 200 && backendRes.statusCode < 500) {
        circuitBreaker.recordSuccess(backend);
      }
    });
  });


  proxyReq.on('timeout', () => {
    proxyReq.destroy(new Error('Backend connection timeout'));
  });


  proxyReq.on('error', (err) => {

    console.error(`[Proxy] Error forwarding to ${backend.host}:${backend.port} → ${err.message}`);

    if (!clientRes.headersSent) {
      circuitBreaker.recordFailure(backend);
      clientRes.writeHead(502, { 'Content-Type': 'application/json' });
      clientRes.end(JSON.stringify({
        error: 'Bad Gateway',
        message: `Backend ${backend.host}:${backend.port} is unreachable`,
      }));
    }
  });


  clientReq.pipe(proxyReq);


  if (clientReq.complete) {
    proxyReq.end();
  }
}

module.exports = { forward };
