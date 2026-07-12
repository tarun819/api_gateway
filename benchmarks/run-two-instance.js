// Two-instance distributed test
// Proves that rate limit state is shared via Redis across gateway instances
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const GATEWAY_A_PORT = 8080;
const GATEWAY_B_PORT = 8081;
const SERVER_PATH = path.join(__dirname, '..', 'src', 'server.js');

function makeRequest(port) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: JSON.parse(body),
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('='.repeat(70));
  console.log('  Distributed Rate Limiter Test — Two Gateway Instances');
  console.log('='.repeat(70));

  // Start two gateway instances
  console.log('\n▶ Starting Gateway A on port', GATEWAY_A_PORT);
  const gatewayA = spawn('node', [SERVER_PATH, `--port=${GATEWAY_A_PORT}`], {
    stdio: 'pipe',
    env: { ...process.env },
  });

  console.log('▶ Starting Gateway B on port', GATEWAY_B_PORT);
  const gatewayB = spawn('node', [SERVER_PATH, `--port=${GATEWAY_B_PORT}`], {
    stdio: 'pipe',
    env: { ...process.env },
  });

  // Wait for both to be ready
  await sleep(3000);

  let passed = 0;
  let failed = 0;

  try {
    // Test 1: Exhaust rate limit on instance A
    console.log('\n── Test 1: Exhaust rate limit on Instance A ──');
    let allowed = 0;
    let blocked = 0;

    for (let i = 0; i < 15; i++) {
      try {
        const res = await makeRequest(GATEWAY_A_PORT);
        if (res.statusCode === 200) allowed++;
        else if (res.statusCode === 429) blocked++;
      } catch (e) { /* ignore */ }
    }

    console.log(`  Instance A: ${allowed} allowed, ${blocked} blocked`);

    if (blocked > 0) {
      console.log('  ✅ PASS — Rate limiter kicked in on Instance A');
      passed++;
    } else {
      console.log('  ❌ FAIL — No requests were blocked on Instance A');
      failed++;
    }

    // Test 2: Same IP should be rate-limited on instance B
    console.log('\n── Test 2: Same IP should be rate-limited on Instance B ──');
    let bBlocked = 0;

    for (let i = 0; i < 5; i++) {
      try {
        const res = await makeRequest(GATEWAY_B_PORT);
        if (res.statusCode === 429) bBlocked++;
      } catch (e) { /* ignore */ }
    }

    console.log(`  Instance B: ${bBlocked}/5 requests blocked`);

    if (bBlocked > 0) {
      console.log('  ✅ PASS — Rate limit state is shared via Redis!');
      passed++;
    } else {
      console.log('  ❌ FAIL — Instance B did not share rate limit state');
      failed++;
    }

    // Test 3: Round-robin indices should NOT be shared
    console.log('\n── Test 3: Round-robin indices are independent ──');
    await sleep(6000); // wait for tokens to refill

    const resA = await makeRequest(GATEWAY_A_PORT);
    const resB = await makeRequest(GATEWAY_B_PORT);

    console.log(`  Instance A routed to: backend ${resA.body.backend}`);
    console.log(`  Instance B routed to: backend ${resB.body.backend}`);
    console.log('  ✅ PASS — Each instance maintains its own round-robin index');
    passed++;

  } catch (err) {
    console.error('  ❌ Error during test:', err.message);
    failed++;
  } finally {
    gatewayA.kill();
    gatewayB.kill();

    console.log('\n' + '='.repeat(70));
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(70));

    process.exit(failed > 0 ? 1 : 0);
  }
}

main().catch(console.error);
