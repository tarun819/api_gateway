// src/circuitBreaker.js
// Hystrix-style Circuit Breaker for per-backend fault isolation (CLOSED -> OPEN -> HALF_OPEN).

const config = require('./config');

const STATES = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
};

const backends = new Map();

function getBackendState(backendKey) {
  if (!backends.has(backendKey)) {
    backends.set(backendKey, {
      state: STATES.CLOSED,
      failureCount: 0,
      nextAttemptTime: null,
      probeInFlight: false,
    });
  }
  return backends.get(backendKey);
}

function logTransition(backendKey, from, to, reason) {
  console.log(`\n[CircuitBreaker] Backend ${backendKey}: ${from} -> ${to} (${reason})\n`);
}

function canRoute(backend) {
  const key = `${backend.host}:${backend.port}`;
  const record = getBackendState(key);

  if (record.state === STATES.CLOSED) {
    return true;
  }

  if (record.state === STATES.OPEN) {
    if (Date.now() < record.nextAttemptTime) {
      return false;
    }

    record.state = STATES.HALF_OPEN;
    logTransition(key, STATES.OPEN, STATES.HALF_OPEN, 'Cooldown expired');

    if (record.probeInFlight) {
      return false;
    }

    record.probeInFlight = true;
    return true;
  }

  if (record.state === STATES.HALF_OPEN) {
    if (record.probeInFlight) {
      return false;
    }
    record.probeInFlight = true;
    return true;
  }

  return false;
}

function recordFailure(backend) {
  const key = `${backend.host}:${backend.port}`;
  const record = getBackendState(key);

  record.failureCount++;
  record.probeInFlight = false;

  if (record.state === STATES.HALF_OPEN) {
    record.state = STATES.OPEN;
    record.nextAttemptTime = Date.now() + config.circuitBreaker.cooldownMs;
    logTransition(key, STATES.HALF_OPEN, STATES.OPEN, 'Probe failed');
  } else if (record.state === STATES.CLOSED) {
    if (record.failureCount >= config.circuitBreaker.failureThreshold) {
      record.state = STATES.OPEN;
      record.nextAttemptTime = Date.now() + config.circuitBreaker.cooldownMs;
      logTransition(key, STATES.CLOSED, STATES.OPEN, 'Threshold reached');
    }
  }
}

function recordSuccess(backend) {
  const key = `${backend.host}:${backend.port}`;
  const record = getBackendState(key);

  if (record.state === STATES.CLOSED) {
    record.failureCount = 0;
  }

  if (record.state === STATES.HALF_OPEN) {
    record.failureCount = 0;
    record.probeInFlight = false;
    record.state = STATES.CLOSED;
    logTransition(key, STATES.HALF_OPEN, STATES.CLOSED, 'Probe succeeded');
  }
}

module.exports = {
  canRoute,
  recordFailure,
  recordSuccess,
  getBackendState,
  STATES
};
