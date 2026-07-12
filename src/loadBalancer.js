// Round-robin load balancer — cycles through backends, skips unhealthy ones
const config = require('./config');
const healthCheck = require('./healthCheck');

let currentIndex = 0;

function getNext() {
  const backends = config.backends;

  for (let i = 0; i < backends.length; i++) {
    const backend = backends[currentIndex % backends.length];
    currentIndex++;

    // Skip backends marked as down by health checks
    if (healthCheck.getStatus(backend.port) === 'down') continue;

    return backend;
  }

  // All backends are down
  return null;
}

module.exports = { getNext };
