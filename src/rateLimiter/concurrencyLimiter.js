// src/rateLimiter/concurrencyLimiter.js
//
// NOTE: This is the original single-instance concurrency limiter (Phase 11).
// It was replaced by distributedConcurrency.js (Phase 11b) which uses Redis ZSETs
// for cluster-wide enforcement. Kept here as a reference for the design evolution.
//
// Why this approach fails in a distributed setting:
//   - Each gateway process has its own Map, so a client can open maxConcurrent
//     connections on Gateway A AND maxConcurrent on Gateway B — bypassing the limit.
//   - A simple Redis INCR/DECR counter also doesn't work because if a gateway
//     crashes mid-request, the DECR never fires and you permanently leak a slot.
// Limits the number of simultaneous, in-flight requests per client IP.
//
// Unlike the Token Bucket (which tracks requests over time using Redis),
// this tracks active TCP sockets locally in-memory.
//
// Why local memory?
//   Because a connection socket belongs to this specific gateway process.
//   If a client opens 10 connections to Gateway A, Gateway A needs to track
//   those 10 connections. Gateway B doesn't care about them, because Gateway B
//   isn't holding those sockets open.

const config = require('../config');

// In-memory map: IP -> Number of currently active requests
const activeRequests = new Map();

/**
 * Checks if a client is allowed to open a new request, and increments their counter.
 *
 * @param {string} ip - The client's IP address.
 * @returns {boolean} True if allowed, false if rejected (too many concurrent requests).
 */
function acquire(ip) {
  const current = activeRequests.get(ip) || 0;

  if (current >= config.rateLimit.maxConcurrentRequests) {
    // Reject the request, do not increment
    return false;
  }

  // Allow the request, increment the counter
  activeRequests.set(ip, current + 1);
  return true;
}

/**
 * Decrements the active request counter for a client.
 * MUST be called exactly once when the request finishes or closes.
 *
 * @param {string} ip - The client's IP address.
 */
function release(ip) {
  const current = activeRequests.get(ip);
  if (current === undefined) return;

  if (current <= 1) {
    // If it's 0 or 1, deleting the key prevents a memory leak.
    // If we just set it to 0, the Map would grow infinitely for every unique IP.
    activeRequests.delete(ip);
  } else {
    activeRequests.set(ip, current - 1);
  }
}

module.exports = { acquire, release };
