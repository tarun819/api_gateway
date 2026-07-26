// src/circuitBreaker.js - Sliding window Circuit Breaker (CLOSED, OPEN, HALF_OPEN)
const config = require('./config');

const STATES = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
};

const backends = new Map();

// 1. O(1) sliding window ring buffer state helper
function getBackendState(backendKey) {
  if (!backends.has(backendKey)) {
    const size = config.circuitBreaker.windowSize;
    backends.set(backendKey, {
      state: STATES.CLOSED,
      results: new Array(size).fill(1),
      index: 0,
      sum: size,
      nextAttemptTime: null,
      probeInFlight: false,
    });
  }
  return backends.get(backendKey);
}

function recordOutcome(record, success) {
  const oldValue = record.results[record.index];
  const newValue = success ? 1 : 0;
  record.sum += newValue - oldValue;
  record.results[record.index] = newValue;
  record.index = (record.index + 1) % record.results.length;
}

function getFailureRate(record) {
  return (record.results.length - record.sum) / record.results.length;
}

function resetWindow(record) {
  record.results.fill(1);
  record.index = 0;
  record.sum = record.results.length;
}

function logTransition(backendKey, from, to, reason) {
  console.log(`\n[CircuitBreaker] Backend ${backendKey}: ${from} -> ${to} (${reason})\n`);
}

// 2. Evaluates if traffic can route to a backend & manages HALF_OPEN single probe locks
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

// 3. Trip to OPEN when failure threshold is exceeded or when a HALF_OPEN probe fails
function recordFailure(backend) {
  const key = `${backend.host}:${backend.port}`;
  const record = getBackendState(key);

  record.probeInFlight = false;

  if (record.state === STATES.HALF_OPEN) {
    record.state = STATES.OPEN;
    record.nextAttemptTime = Date.now() + config.circuitBreaker.cooldownMs;
    logTransition(key, STATES.HALF_OPEN, STATES.OPEN, 'Probe failed');
  } else if (record.state === STATES.CLOSED) {
    recordOutcome(record, false);
    const rate = getFailureRate(record);
    if (rate >= config.circuitBreaker.failureRateThreshold) {
      record.state = STATES.OPEN;
      record.nextAttemptTime = Date.now() + config.circuitBreaker.cooldownMs;
      logTransition(key, STATES.CLOSED, STATES.OPEN,
        `Failure rate ${(rate * 100).toFixed(0)}% >= ${(config.circuitBreaker.failureRateThreshold * 100).toFixed(0)}% threshold`);
    }
  }
}

// 4. Recover circuit back to CLOSED on successful HALF_OPEN probe
function recordSuccess(backend) {
  const key = `${backend.host}:${backend.port}`;
  const record = getBackendState(key);

  if (record.state === STATES.CLOSED) {
    recordOutcome(record, true);
  }

  if (record.state === STATES.HALF_OPEN) {
    record.probeInFlight = false;
    resetWindow(record);
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
