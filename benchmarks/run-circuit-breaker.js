// benchmarks/run-circuit-breaker.js
// End-to-end lifecycle test for the Sliding Window Circuit Breaker.
// Usage: node benchmarks/run-circuit-breaker.js

const http = require('http');
const config = require('../src/config');
const { spawn } = require('child_process');

const PORT = 8080;
let gatewayProcess, backendProcess;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const cooldown = () => sleep(2500);

function httpGet(path = '/api/users') {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${PORT}${path}`, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let parsed; try { parsed = JSON.parse(body); } catch { parsed = body; }
        resolve({ status: res.statusCode, body: parsed });
      });
    }).on('error', (err) => resolve({ status: 0, error: err.message }));

    req.setTimeout(5000, () => {
      req.destroy();
      resolve({ status: 0, error: 'Benchmark client timeout' });
    });
  });
}

async function assert(expected, label) {
  const res = await httpGet();
  const pass = res.status === expected;
  if (!pass) {
    console.log(`  ✗ [${res.status}] ${label} ${res.error ? `(Error: ${res.error})` : ''}`);
    throw new Error(`Expected ${expected}, got ${res.status}: ${label}`);
  }
  console.log(`  ✓ [${res.status}] ${label}`);
  return res;
}

async function tripCircuit() {
  const n = Math.ceil(config.circuitBreaker.windowSize * config.circuitBreaker.failureRateThreshold);
  for (let i = 1; i <= n; i++) {
    await assert(502, `Failure ${i}/${n}`);
  }
}

function spawnBackend() {
  backendProcess = spawn('node', ['benchmarks/mockBackend.js', '--port=4001']);
}

async function startServers() {
  spawnBackend();
  await sleep(1000);
  gatewayProcess = spawn('node', ['src/server.js'], {
    env: { ...process.env, HEALTH_CHECK_INTERVAL: '100000', CIRCUIT_COOLDOWN_MS: '2000' }
  });
  await sleep(2000);
}

function stopServers() {
  if (gatewayProcess) gatewayProcess.kill();
  if (backendProcess) backendProcess.kill();
}



async function main() {
  console.log('\n  Circuit Breaker Lifecycle Test\n');

  try {
    await startServers();

    // 1. Healthy traffic
    console.log('Step 1: Normal Traffic (CLOSED)');
    await assert(200, 'Backend is healthy');

    // 2. Kill backend → trip circuit
    console.log('\nStep 2: Kill Backend → Trip to OPEN');
    backendProcess.kill();
    await sleep(500);
    await tripCircuit();
    await assert(503, 'Circuit is OPEN, instant 503');

    // 3. Cooldown → probe fails (backend still dead) → back to OPEN
    console.log('\nStep 3: Cooldown → Failed Probe (HALF_OPEN → OPEN)');
    await cooldown();
    let [probe, blocked] = await Promise.all([httpGet(), httpGet()]);
    console.log(`  ✓ [${probe.status}] Probe (backend still dead)`);
    console.log(`  ✓ [${blocked.status}] Second request blocked by probeInFlight`);
    if (blocked.status !== 503) throw new Error('probeInFlight logic failed!');
    await assert(503, 'Back to OPEN after failed probe');

    // 4. Restart backend → cooldown → probe succeeds → CLOSED
    console.log('\nStep 4: Restart Backend → Successful Probe (HALF_OPEN → CLOSED)');
    spawnBackend();
    await cooldown();
    await assert(200, 'Probe succeeded, circuit recovering');

    // 5. Verify full recovery
    console.log('\nStep 5: Verify Recovery (CLOSED)');
    await assert(200, 'Traffic flowing normally');

    console.log('\n   PASSED: CLOSED → OPEN → HALF_OPEN → OPEN → HALF_OPEN → CLOSED\n');
  } catch (err) {
    console.error('\n  FAILED:', err.message, '\n');
  } finally {
    stopServers();
  }
}

main().catch(console.error);
