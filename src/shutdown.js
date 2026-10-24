// src/shutdown.js
// Graceful shutdown handler.

const SHUTDOWN_TIMEOUT_MS = 10000;


function setup({ server, healthCheck, rateLimiter, distributedConcurrency }) {
  let isShuttingDown = false;

  async function shutdown(signal) {
    if (isShuttingDown) {
      console.log('\n[Shutdown] Forced exit (second signal received)');
      process.exit(1);
    }

    isShuttingDown = true;
    console.log(`\n[Shutdown] ${signal} received — shutting down gracefully...`);


    server.close(async () => {
      console.log('[Shutdown] All in-flight requests completed');


      healthCheck.stop();


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



  function shutdownWithTimeout(signal) {
    shutdown(signal);

    const timer = setTimeout(() => {
      console.error(`[Shutdown] Timed out after ${SHUTDOWN_TIMEOUT_MS / 1000}s — forcing exit`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);


    timer.unref();
  }

  process.on('SIGINT', () => shutdownWithTimeout('SIGINT'));
  process.on('SIGTERM', () => shutdownWithTimeout('SIGTERM'));
}

module.exports = { setup };
