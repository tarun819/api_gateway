// src/loadBalancer.js - Round-robin load balancer with health and circuit breaker awareness
const config = require('./config');
const healthCheck = require('./healthCheck');
const circuitBreaker = require('./circuitBreaker');

let currentIndex = 0;

// 1. Returns next healthy backend in round-robin order (skips DOWN or OPEN circuit nodes)
function getNext() {
  const backends = config.backends;

  for (let i = 0; i < backends.length; i++) {
    const backend = backends[currentIndex % backends.length];
    currentIndex++;

    const status = healthCheck.getStatus(backend.port);

    if (status === 'up' && circuitBreaker.canRoute(backend)) {
      return backend;
    }
  }

  return null;
}

module.exports = { getNext, getNextBackend: getNext };
