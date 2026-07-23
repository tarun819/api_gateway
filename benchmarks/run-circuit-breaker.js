// benchmarks/run-circuit-breaker.js
// Tests the Netflix Hystrix-style Circuit Breaker implementation.
//
// Usage: node benchmarks/run-circuit-breaker.js

const http = require('http');
const config = require('../src/config');
const { spawn } = require('child_process');

const PORT = 8080;
const BACKEND_PORT = 4001; // We will test against just one backend

let gatewayProcess;
let backendProcess;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpGet(path = '/') {
  return new Promise((resolve) => {
    http.get(`http://localhost:${PORT}${path}`, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch (e) { parsed = body; }
        resolve({
          status: res.statusCode,
          body: parsed,
        });
      });
    }).on('error', (err) => resolve({ status: 0, error: err.message }));
  });
}

async function startServers() {
  console.log('  Starting backend server on port 4001...');
  backendProcess = spawn('node', ['benchmarks/mockBackend.js', '--port=4001']);
  
  // Wait for backend to start before starting gateway
  await sleep(1000);

  console.log(`  Starting gateway on port ${PORT}...`);
  // Override health check interval so it doesn't interfere, and reduce cooldown for faster tests
  gatewayProcess = spawn('node', ['src/server.js'], {
    env: { ...process.env, HEALTH_CHECK_INTERVAL: '100000' }
  });

  await sleep(2000);
}

function stopServers() {
  if (gatewayProcess) gatewayProcess.kill();
  if (backendProcess) backendProcess.kill();
}

async function main() {
  console.log('\n  Circuit Breaker Test');
  console.log('  ─────────────────────────────────────\n');

  try {
    await startServers();

    console.log('\n--- Step 1: Normal Traffic (Circuit CLOSED) ---');
    let res = await httpGet();
    console.log(`Request 1 Status: ${res.status} (Expected 200)`);
    if (res.status !== 200) throw new Error('Backend should be healthy');

    console.log('\n--- Step 2: Force Backend Failures ---');
    console.log('Killing the backend server to simulate a crash...');
    backendProcess.kill();
    await sleep(500); // Give it time to die

    // Hit the gateway enough times to trip the threshold (default 5)
    for (let i = 1; i <= config.circuitBreaker.failureThreshold; i++) {
      res = await httpGet();
      // It should return 502 Bad Gateway because proxy is failing to connect
      console.log(`Failure Request ${i} Status: ${res.status} (Expected 502)`);
    }

    console.log('\n--- Step 3: Verify Circuit is OPEN ---');
    res = await httpGet();
    console.log(`Open Circuit Request Status: ${res.status} (Expected 503)`);
    if (res.status !== 503) throw new Error('Circuit Breaker did not trip to OPEN!');
    console.log('Success! The Gateway is now instantly rejecting traffic with 503 without hitting the backend.');

    console.log(`\n--- Step 4: Wait for Cooldown (${config.circuitBreaker.cooldownMs / 1000}s) ---`);
    console.log('Waiting...');
    await sleep(config.circuitBreaker.cooldownMs + 500);

    console.log('\n--- Step 5: Verify HALF_OPEN (Probe in flight) ---');
    console.log('Sending first request. It should be allowed through as a probe.');
    let probePromise1 = httpGet();
    
    // Immediately send a second request while the first is in-flight
    let probePromise2 = httpGet();

    let [res1, res2] = await Promise.all([probePromise1, probePromise2]);
    
    console.log(`Probe 1 Status: ${res1.status} (Expected 502, because backend is still dead)`);
    console.log(`Probe 2 Status: ${res2.status} (Expected 503, because only ONE probe is allowed in flight)`);
    
    if (res2.status !== 503) throw new Error('probeInFlight logic failed! Second request was not blocked.');

    console.log('\n--- Step 6: Verify Circuit Tripped back to OPEN ---');
    res = await httpGet();
    console.log(`Follow-up Request Status: ${res.status} (Expected 503)`);
    if (res.status !== 503) throw new Error('Circuit did not flip back to OPEN after probe failed!');

    console.log('\n  ✅ Circuit Breaker implementation passed all tests!');
  } catch (err) {
    console.error('\n  ❌ Test failed:', err.message);
  } finally {
    stopServers();
  }
}

main().catch(console.error);
