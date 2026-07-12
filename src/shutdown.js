// Graceful shutdown handler
// Stops accepting new connections, drains in-flight requests, then exits cleanly

let server = null;
let healthCheck = null;
let redisClient = null;
let inFlightRequests = 0;
const DRAIN_TIMEOUT = 10000; // 10 seconds max to drain

function trackRequest() {
  inFlightRequests++;
}

function untrackRequest() {
  inFlightRequests--;
}

function register(httpServer, healthCheckModule, redis) {
  server = httpServer;
  healthCheck = healthCheckModule;
  redisClient = redis;

  const shutdown = (signal) => {
    console.log(`\n[Shutdown] Received ${signal}, shutting down gracefully...`);

    // Stop accepting new connections
    server.close(() => {
      console.log('[Shutdown] Server closed, no new connections accepted');
    });

    // Stop health checks
    if (healthCheck) healthCheck.stop();

    // Wait for in-flight requests to finish
    const drainStart = Date.now();
    const drainInterval = setInterval(async () => {
      if (inFlightRequests <= 0 || Date.now() - drainStart > DRAIN_TIMEOUT) {
        clearInterval(drainInterval);

        if (inFlightRequests > 0) {
          console.log(`[Shutdown] Timeout reached with ${inFlightRequests} in-flight requests, force exiting`);
        } else {
          console.log('[Shutdown] All in-flight requests completed');
        }

        // Close Redis connection
        if (redisClient) {
          try {
            await redisClient.quit();
            console.log('[Shutdown] Redis connection closed');
          } catch (e) { /* ignore */ }
        }

        console.log('[Shutdown] Goodbye!');
        process.exit(inFlightRequests > 0 ? 1 : 0);
      }
    }, 100);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { register, trackRequest, untrackRequest };
