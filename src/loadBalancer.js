// src/loadBalancer.js
// Per-pool round-robin load balancer with health-aware and circuit breaker-aware routing.
//
// Each backend pool (one per route) gets its own independent round-robin counter.
// This means traffic to /api/users rotates through user-service instances independently
// from traffic to /api/orders rotating through order-service instances.


const config = require('./config');
const healthCheck = require('./healthCheck');
const circuitBreaker = require('./circuitBreaker');

// Per-pool round-robin counters.
// Key: a stable string identifying the pool (joined port list).
// Value: the current index for that pool's round-robin cycle.
const counters = new Map();


function poolKey(backends) {
  return backends.map(b => `${b.host}:${b.port}`).join(',');
}

/**
 * Picks the next healthy backend from the given pool using round-robin.
 * Skips backends that are health-check 'down' or circuit-breaker OPEN.
 *
 * @param {object[]} backends - The backend pool to pick from.
 * @returns {object|null} The chosen backend, or null if all are unavailable.
 */
function getNextForPool(backends) {
  const key = poolKey(backends);
  let idx = counters.get(key) || 0;

  for (let i = 0; i < backends.length; i++) {
    const backend = backends[idx % backends.length];
    idx++;

    const status = healthCheck.getStatus(backend.port);

    if (status === 'up' && circuitBreaker.canRoute(backend)) {
      counters.set(key, idx);
      return backend;
    }
  }

  counters.set(key, idx);
  return null;
}


function getNext() {
  return getNextForPool(config.backends);
}

module.exports = { getNext, getNextBackend: getNext, getNextForPool };

