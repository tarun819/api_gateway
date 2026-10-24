
const http = require('http');

let port = 4001;
const portArg = process.argv.find(arg => arg.startsWith('--port='));
if (portArg) {
  port = parseInt(portArg.split('=')[1], 10);
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'UP', port: port }));
    return;
  }

  setTimeout(() => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: `Hello from Mock Backend on port ${port}` }));
  }, 10);
});

server.listen(port, () => {
  console.log(`[MockBackend] Listening on port ${port}`);
});
