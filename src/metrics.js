// src/metrics.js - In-memory observability metrics tracker
const startTime = Date.now();

const counters = {
  totalRequests: 0,
  blockedRequests: 0,
  redisFallbacks: 0,
  requestsPerBackend: {},
};

// 1. Metric recorders for traffic, rate-limit blocks, and Redis fallbacks
function recordRequest(backendPort) {
  counters.totalRequests++;
  if (backendPort) {
    counters.requestsPerBackend[backendPort] =
      (counters.requestsPerBackend[backendPort] || 0) + 1;
  }
}

function recordBlocked() {
  counters.totalRequests++;
  counters.blockedRequests++;
}

function recordRedisFallback() {
  counters.redisFallbacks++;
}

// 2. Returns structured snapshot for GET /metrics endpoint
function getSnapshot(healthStatus) {
  return {
    uptime: Math.floor((Date.now() - startTime) / 1000),
    totalRequests: counters.totalRequests,
    blockedRequests: counters.blockedRequests,
    redisFallbacks: counters.redisFallbacks,
    requestsPerBackend: { ...counters.requestsPerBackend },
    backendHealth: healthStatus || {},
  };
}

module.exports = { recordRequest, recordBlocked, recordRedisFallback, getSnapshot };
