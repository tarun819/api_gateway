// src/metrics.js
// In-memory metrics counters for the API gateway.
//
// This module tracks gateway-level statistics for monitoring and debugging:
//   - Total requests received
//   - Requests blocked by rate limiter (429s)
//   - Redis fallbacks (times we failed-open because Redis was down)
//   - Requests routed to each backend (shows load balancer distribution)

const startTime = Date.now();

const counters = {
  totalRequests: 0,
  blockedRequests: 0,
  redisFallbacks: 0,
  requestsPerBackend: {},
};


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

/**
 * Returns a snapshot of all metrics, including backend health status.
 *
 * @param {object} healthStatus - Passed in from healthCheck module.
 * @returns {object} The complete metrics snapshot.
 */
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
