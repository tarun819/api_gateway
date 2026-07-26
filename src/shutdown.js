// src/shutdown.js
// Graceful shutdown handler.
//
// Why graceful shutdown matters:
//   Without it, hitting Ctrl+C immediately kills the process. Any request
//   that is mid-flight gets abruptly disconnected (client sees ECONNRESET).
//
//   With graceful shutdown, we:
//   1. Stop accepting NEW connections (server.close())
//   2. Wait for IN-FLIGHT requests to finish naturally
//   3. Clean up resources (Redis connections, health check timer)
//   4. Exit cleanly

const SHUTDOWN_TIMEOUT_MS = 10000;

/**
 * Sets up graceful shutdown listeners for SIGTERM and SIGINT.
 */
function setup({ server, healthCheck, rateLimiter, distributedConcurrency }) {
  let isShuttingDown = false;

  async function shutdown(signal) {
    if (isShuttingDown) {
      console.log('\n[Shutdown] Forced exit (second signal received)');
      process.exit(1);
    }

    isShuttingDown = true;
    console.log(`\n[Shutdown] ${signal} received — shutting down gracefully...`);

    // Step 1: Stop accepting new connections.
    server.close(async () => {
      console.log('[Shutdown] All in-flight requests completed');

      // Step 2: Stop the health check timer.
      healthCheck.stop();

      // Step 3: Close Redis connections cleanly.
      try {
        if (rateLimiter && typeof rateLimiter.close === 'function') {
          await rateLimiter.close();
        }
        if (distributedConcurrency && typeof distributedConcurrency.close === 'function') {
          await distributedConcurrency.close();
        }
      } catch (err) {
        console.error(`[Shutdown] Error closing Redis: ${err.message}`);
      }

      console.log('[Shutdown] Cleanup complete — exiting');
      process.exit(0);
    });
  }

  // Step 4: Set a hard deadline.
  // If in-flight requests don't finish within 10 seconds, force-kill.
  function shutdownWithTimeout(signal) {
    shutdown(signal);

    const timer = setTimeout(() => {
      console.error(`[Shutdown] Timed out after ${SHUTDOWN_TIMEOUT_MS / 1000}s — forcing exit`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    // timer.unref() ensures the timer itself doesn't block process exit
    timer.unref();
  }

  process.on('SIGINT', () => shutdownWithTimeout('SIGINT'));
  process.on('SIGTERM', () => shutdownWithTimeout('SIGTERM'));
}

module.exports = { setup };
