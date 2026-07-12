// Health check — pings each backend's /health endpoint on a timer
const http = require('http');
const config = require('./config');

const status = new Map(); // port → 'up' | 'down'

// Initialize all backends as 'up'
config.backends.forEach(b => status.set(b.port, 'up'));

function checkBackend(backend) {
  const req = http.get({
    hostname: backend.host,
    port: backend.port,
    path: config.healthCheck.path,
    timeout: config.healthCheck.timeoutMs,
  }, (res) => {
    const newStatus = res.statusCode === 200 ? 'up' : 'down';
    const prev = status.get(backend.port);
    status.set(backend.port, newStatus);
    if (prev !== newStatus) {
      console.log(`[Health] Backend ${backend.port}: ${prev} → ${newStatus}`);
    }
  });

  req.on('error', () => {
    const prev = status.get(backend.port);
    status.set(backend.port, 'down');
    if (prev !== 'down') {
      console.log(`[Health] Backend ${backend.port}: ${prev} → down (unreachable)`);
    }
  });

  req.on('timeout', () => {
    req.destroy();
  });
}

let intervalId = null;

function start() {
  // Run immediately, then on interval
  config.backends.forEach(checkBackend);
  intervalId = setInterval(() => {
    config.backends.forEach(checkBackend);
  }, config.healthCheck.intervalMs);
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function getStatus(port) {
  return status.get(port) || 'down';
}

function getAllStatus() {
  const result = {};
  status.forEach((s, port) => { result[port] = s; });
  return result;
}

module.exports = { start, stop, getStatus, getAllStatus };
