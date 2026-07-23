// src/loadBalancer.js
// Round-robin load balancer with health-check and circuit breaker integration.

const config = require('./config');
const healthCheck = require('./healthCheck');
const circuitBreaker = require('./circuitBreaker');

let currentIndex = 0;

function getNext() {
  const backends = config.backends;

  for (let i = 0; i < backends.length; i++) {
    const backend = backends[currentIndex % backends.length];
    currentIndex++;

    const status = healthCheck.getStatus(backend.port);

    // Skip if marked DOWN by health check or if Circuit Breaker blocks routing
    if (status === 'up' && circuitBreaker.canRoute(backend)) {
      return backend;
    }
  }

  return null;
}

module.exports = { getNext, getNextBackend: getNext };
