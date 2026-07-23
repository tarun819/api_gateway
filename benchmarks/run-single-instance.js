// benchmarks/run-single-instance.js
// Load test for a single gateway instance using autocannon.
//
// This script fires thousands of HTTP requests at the gateway and measures:
//   - Throughput: how many requests per second the gateway can handle
//   - Latency percentiles: p50 (typical), p95 (slow), p99 (worst case for most users)
//   - Error count: requests that failed entirely (connection refused, timeout)
//   - 429 count: requests blocked by the rate limiter
//
// We test at 3 concurrency levels (10, 50, 100 simultaneous connections)
// to see how the gateway performs under increasing pressure.
//
// Prerequisites:
//   1. Redis must be running on localhost:6379
//   2. Mock backends must be running: npm run start:backends
//   3. Gateway must be running: npm run start
//
// Usage: node benchmarks/run-single-instance.js

const autocannon = require('autocannon');

// The URL to hit. Every request goes to the gateway, which load-balances
// it across the 3 mock backends.
const TARGET = 'http://localhost:8080/';

// We test at 3 concurrency levels to see how the gateway scales.
// "connections" = the number of simultaneous TCP connections autocannon
// keeps open at once. Think of it as simulating N users hitting the API
// at the exact same moment.
const CONCURRENCY_LEVELS = [10, 50, 100];

// How long to run each test. 10 seconds gives enough data for stable
// averages without making the benchmark take forever.
const DURATION = 10;

/**
 * Runs a single autocannon benchmark at the given concurrency level.
 *
 * @param {number} connections - How many simultaneous connections to open.
 * @returns {Promise<object>} The autocannon result object containing
 *   throughput, latency percentiles, status code counts, and errors.
 */
function runBenchmark(connections) {
  return new Promise((resolve, reject) => {
    // autocannon() starts the load test and calls the callback when done.
    // The result object contains everything we need:
    //   result.requests.average  → average requests/sec
    //   result.latency.p50       → 50th percentile latency in ms
    //   result.latency.p95       → 95th percentile latency in ms
    //   result.latency.p99       → 99th percentile latency in ms
    //   result.requests.total    → total requests sent
    //   result['2xx']            → count of 200-299 responses
    //   result['4xx']            → count of 400-499 responses (includes 429s)
    //   result.errors            → count of connection errors
    const instance = autocannon({
      url: TARGET,
      connections,
      duration: DURATION,
    }, (err, result) => {
      if (err) {
        return reject(err); 
      }
      resolve(result);
    });
  });
}

/**
 * Main function — runs benchmarks at all concurrency levels and prints results.
 */
async function main() {
  console.log('\n  Benchmark — Single Instance');
  console.log(`  Target: ${TARGET} | Duration: ${DURATION}s per level\n`);

  const results = [];

  for (const connections of CONCURRENCY_LEVELS) {
    console.log(`  ▶ ${connections} connections...`);
    const result = await runBenchmark(connections);

    const row = {
      connections,
      'req/sec': Math.round(result.requests.average),
      'p50 (ms)': result.latency.p50,
      'p97.5 (ms)': result.latency['p97_5'],
      'p99 (ms)': result.latency.p99,
      '2xx': result['2xx'],
      '429s': result['4xx'] || 0,
      'errors': result.errors,
    };

    results.push(row);
  }

  console.log('');
  console.table(results);
}

main().catch(console.error);

