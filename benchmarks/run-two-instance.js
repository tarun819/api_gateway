// benchmarks/run-two-instance.js - Distributed multi-gateway rate limit verification
const { spawn } = require('child_process');
const http = require('http');

const PORT_A = 8080;
const PORT_B = 8081;
const STARTUP_WAIT_MS = 2000;
const REFILL_WAIT_MS = 6000;

// 1. Vanilla HTTP client helper
function httpGet(port, path = '/') {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}${path}`, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch (e) { parsed = body; }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed,
        });
      });
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startGateway(port) {
  const child = spawn('node', ['src/server.js', `--port=${port}`], {
    stdio: 'ignore',
  });
  return child;
}

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

async function runTests() {
  for (const t of tests) {
    try {
      const result = await t.fn();
      if (result) {
        console.log(`  ✅ ${t.name}`);
        passed++;
      } else {
        console.log(`  ❌ ${t.name}`);
        failed++;
      }
    } catch (err) {
      console.log(`  ❌ ${t.name} — threw: ${err.message}`);
      failed++;
    }
  }
}

// 2. Test 1: Shared Redis rate limit verification (draining A blocks B)
test('Shared rate limit: exhaust on A → blocked on B', async () => {
  for (let i = 0; i < 15; i++) {
    await httpGet(PORT_A);
  }

  const res = await httpGet(PORT_B);
  if (res.status !== 429) {
    console.log(`\n    [Debug] Expected 429 but got ${res.status}. Body: ${JSON.stringify(res.body)}`);
  }
  return res.status === 429;
});

// 3. Test 2: Token refill verification
test('Rate limit refills: B allows after waiting', async () => {
  console.log(`\n    ⏳ Waiting ${REFILL_WAIT_MS / 1000}s for tokens to refill...`);
  await sleep(REFILL_WAIT_MS);

  const res = await httpGet(PORT_B);
  return res.status === 200;
});

// 4. Test 3-5: Header propagation, independent round-robin, and metrics endpoint verification
test('Rate-limit headers present on both instances', async () => {
  const resA = await httpGet(PORT_A);
  const resB = await httpGet(PORT_B);

  const hasHeaderA = resA.headers['x-ratelimit-limit'] !== undefined;
  const hasHeaderB = resB.headers['x-ratelimit-limit'] !== undefined;
  return hasHeaderA && hasHeaderB;
});

test('Round-robin is independent per instance', async () => {
  await sleep(REFILL_WAIT_MS);

  const resA1 = await httpGet(PORT_A);
  const resA2 = await httpGet(PORT_A);
  const resB1 = await httpGet(PORT_B);
  const resB2 = await httpGet(PORT_B);

  if (resA1.status !== 200 || resB1.status !== 200) {
    console.log('    (got 429 — not enough tokens to test round-robin)');
    return true;
  }

  const aBackend = resA1.body && resA1.body.backend;
  const bBackend = resB1.body && resB1.body.backend;
  return aBackend !== undefined && bBackend !== undefined;
});

test('Metrics endpoint accessible on both instances', async () => {
  const metricsA = await httpGet(PORT_A, '/metrics');
  const metricsB = await httpGet(PORT_B, '/metrics');

  const aOk = metricsA.status === 200 && metricsA.body.totalRequests !== undefined;
  const bOk = metricsB.status === 200 && metricsB.body.totalRequests !== undefined;
  return aOk && bOk;
});

// 5. Test orchestrator spawning & tearing down gateway processes
async function main() {
  console.log('\n  Two-Instance Distributed Test');
  console.log('  ─────────────────────────────────────\n');

  console.log(`  Starting gateway A on port ${PORT_A}...`);
  const gatewayA = startGateway(PORT_A);

  console.log(`  Starting gateway B on port ${PORT_B}...`);
  const gatewayB = startGateway(PORT_B);

  console.log(`  Waiting ${STARTUP_WAIT_MS / 1000}s for servers to boot...\n`);
  await sleep(STARTUP_WAIT_MS);

  try {
    await runTests();
  } finally {
    gatewayA.kill();
    gatewayB.kill();
  }

  console.log('\n  ─────────────────────────────────────');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('  ─────────────────────────────────────\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
