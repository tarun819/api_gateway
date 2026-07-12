// Benchmark — single gateway instance
// Uses autocannon to load test and capture throughput + latency
const autocannon = require('autocannon');

const TARGET = 'http://localhost:8080/';
const CONCURRENCY_LEVELS = [10, 50, 100];
const DURATION = 10; // seconds per test

async function runBenchmark(connections) {
  return new Promise((resolve) => {
    const instance = autocannon({
      url: TARGET,
      connections,
      duration: DURATION,
    }, (err, result) => {
      resolve(result);
    });

    autocannon.track(instance, { renderProgressBar: false });
  });
}

async function main() {
  console.log('='.repeat(70));
  console.log('  API Gateway Benchmark — Single Instance');
  console.log('='.repeat(70));
  console.log(`  Target: ${TARGET}`);
  console.log(`  Duration: ${DURATION}s per level\n`);

  const results = [];

  for (const connections of CONCURRENCY_LEVELS) {
    console.log(`\n▶ Testing with ${connections} concurrent connections...`);
    const result = await runBenchmark(connections);

    const row = {
      connections,
      'req/sec': Math.round(result.requests.average),
      'p50 (ms)': result.latency.p50,
      'p95 (ms)': result.latency.p95,
      'p99 (ms)': result.latency.p99,
      'total': result.requests.total,
      '2xx': result['2xx'],
      '429s': result['4xx'] || 0,
      'errors': result.errors,
    };

    results.push(row);
    console.log(`  ✓ ${row['req/sec']} req/s | p50: ${row['p50 (ms)']}ms | p99: ${row['p99 (ms)']}ms | 429s: ${row['429s']}`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('  Results Summary');
  console.log('='.repeat(70));
  console.table(results);
}

main().catch(console.error);
