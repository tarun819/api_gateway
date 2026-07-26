// src/healthCheck.js - Background periodic health check poller
const http = require('http');
const config = require('./config');

const status = {};
config.backends.forEach((backend) => {
  status[backend.port] = 'up';
});

// 1. Get health status of specific backend or full map
function getStatus(port) {
  return status[port] || 'down';
}

function getAllStatuses() {
  return { ...status };
}

// 2. Ping individual backend /health endpoint and update state map
function checkBackend(backend) {
  const options = {
    hostname: backend.host,
    port: backend.port,
    path: config.healthCheck.path,
    method: 'GET',
    timeout: config.healthCheck.timeoutMs,
  };

  const req = http.request(options, (res) => {
    res.resume();
    const previousStatus = status[backend.port];
    const newStatus = res.statusCode === 200 ? 'up' : 'down';
    status[backend.port] = newStatus;

    if (previousStatus !== newStatus) {
      console.log(`[HealthCheck] Backend ${backend.port}: ${previousStatus} → ${newStatus}`);
    }
  });

  req.on('error', (err) => {
    const previousStatus = status[backend.port];
    status[backend.port] = 'down';

    if (previousStatus !== 'down') {
      console.log(`[HealthCheck] Backend ${backend.port}: ${previousStatus} → down (${err.message})`);
    }
  });

  req.on('timeout', () => {
    req.destroy();
  });

  req.end();
}

function runHealthCheckCycle() {
  config.backends.forEach((backend) => {
    checkBackend(backend);
  });
}

let intervalId = null;

// 3. Control background polling lifecycle
function start() {
  runHealthCheckCycle();
  intervalId = setInterval(runHealthCheckCycle, config.healthCheck.intervalMs);
  console.log(`[HealthCheck] Started — checking every ${config.healthCheck.intervalMs}ms`);
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[HealthCheck] Stopped');
  }
}

module.exports = { getStatus, getAllStatuses, start, stop };
