// benchmarks/run-single-instance.js - Autocannon single-instance performance benchmark
const autocannon = require('autocannon');

const TARGET = 'http://localhost:8080/';
const CONCURRENCY_LEVELS = [10, 50, 100];
const DURATION = 10;

// 1. Promisified autocannon wrapper for running load tests at specific concurrency levels
function runBenchmark(connections) {
  return new Promise((resolve, reject) => {
    autocannon({
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

// 2. Main runner executing load tests & displaying results table
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
