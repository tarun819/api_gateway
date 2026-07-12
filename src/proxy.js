// Core proxy — forwards requests to a backend and streams the response back
const http = require('http');

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
    backendRes.pipe(clientRes);
  });

  proxyReq.on('error', (err) => {
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
