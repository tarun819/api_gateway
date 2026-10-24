const { spawn } = require('child_process');
const http = require('http');

const PORT_A = 8080;
const PORT_B = 8081;
const STARTUP_WAIT_MS = 2000;
const REFILL_WAIT_MS = 6000;

function httpGet(port, path = '/api/users') {
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

test('Round-robin is independent per instance', async () => {
  const resA1 = await httpGet(PORT_A);
  const resA2 = await httpGet(PORT_A);
  const resB1 = await httpGet(PORT_B);
  const resB2 = await httpGet(PORT_B);

  if (resA1.status !== 200 || resA2.status !== 200 || resB1.status !== 200 || resB2.status !== 200) {
    console.log('    (got non-200 — cannot verify round-robin)');
    return false;
  }

  const aRotated = resA1.body.backend !== resA2.body.backend;
  const bIndependent = resB1.body.backend === resA1.body.backend;

  if (!aRotated) console.log(`    [Debug] A didn't rotate: ${resA1.body.backend} → ${resA2.body.backend}`);
  if (!bIndependent) console.log(`    [Debug] B not independent: B got ${resB1.body.backend}, A started at ${resA1.body.backend}`);

  return aRotated && bIndependent;
});

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

test('Rate limit refills: B allows after waiting', async () => {
  console.log(`\n    ⏳ Waiting ${REFILL_WAIT_MS / 1000}s for tokens to refill...`);
  await sleep(REFILL_WAIT_MS);

  const res = await httpGet(PORT_B);
  return res.status === 200;
});

test('Rate-limit headers present on both instances', async () => {
  const resA = await httpGet(PORT_A);
  const resB = await httpGet(PORT_B);

  const hasHeaderA = resA.headers['x-ratelimit-limit'] !== undefined;
  const hasHeaderB = resB.headers['x-ratelimit-limit'] !== undefined;
  return hasHeaderA && hasHeaderB;
});

test('Metrics are independent per instance', async () => {
  const metricsA = await httpGet(PORT_A, '/metrics');
  const metricsB = await httpGet(PORT_B, '/metrics');

  if (metricsA.status !== 200 || metricsB.status !== 200) {
    return false;
  }

  const baseA = metricsA.body.totalRequests;
  const baseB = metricsB.body.totalRequests;

  const REQUEST_COUNT = 3;
  for (let i = 0; i < REQUEST_COUNT; i++) {
    await httpGet(PORT_A);
  }

  const afterA = (await httpGet(PORT_A, '/metrics')).body.totalRequests;
  const afterB = (await httpGet(PORT_B, '/metrics')).body.totalRequests;

  const aIncremented = afterA === baseA + REQUEST_COUNT;
  const bUnchanged = afterB === baseB;

  if (!aIncremented) {
    console.log(`    [Debug] Expected A to increase by ${REQUEST_COUNT}, went from ${baseA} to ${afterA}`);
  }
  if (!bUnchanged) {
    console.log(`    [Debug] Expected B to stay unchanged, went from ${baseB} to ${afterB}`);
  }

  return aIncremented && bUnchanged;
});

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
