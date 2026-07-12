// In-memory metrics for the gateway
const counters = {
  totalRequests: 0,
  blockedRequests: 0,
  redisFallbacks: 0,
  requestsPerBackend: {},
  startTime: Date.now(),
};

function recordRequest(backendPort) {
  counters.totalRequests++;
  if (backendPort) {
    counters.requestsPerBackend[backendPort] = (counters.requestsPerBackend[backendPort] || 0) + 1;
  }
}

function recordBlocked() {
  counters.totalRequests++;
  counters.blockedRequests++;
}

function recordRedisFallback() {
  counters.redisFallbacks++;
}

function getSnapshot(healthStatus) {
  return {
    uptime: Math.floor((Date.now() - counters.startTime) / 1000),
    totalRequests: counters.totalRequests,
    blockedRequests: counters.blockedRequests,
    redisFallbacks: counters.redisFallbacks,
    requestsPerBackend: { ...counters.requestsPerBackend },
    backendHealth: healthStatus || {},
  };
}

module.exports = { recordRequest, recordBlocked, recordRedisFallback, getSnapshot };
