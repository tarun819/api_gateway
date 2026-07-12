# API Gateway with Distributed Rate Limiter

A production-inspired API Gateway built in Node.js using **native HTTP APIs** (no Express), featuring round-robin load balancing with health checks and a Redis-backed rate limiter made atomic via Lua scripting.

## Architecture

```
                    ┌─────────────────────────────────────────┐
                    │            API Gateway (:8080)           │
  Client ──────►   │                                         │
                    │  ┌──────────┐  ┌───────────────────┐   │
                    │  │   Rate   │  │   Load Balancer    │   │
                    │  │ Limiter  │  │  (Round-Robin)     │   │
                    │  └────┬─────┘  └──┬────┬────┬──────┘   │
                    │       │           │    │    │           │
                    └───────┼───────────┼────┼────┼───────────┘
                            │           │    │    │
                     ┌──────┴──┐    ┌───┘    │    └───┐
                     │  Redis  │    │        │        │
                     │ (state) │    ▼        ▼        ▼
                     └─────────┘  :4001    :4002    :4003
                                 Backend  Backend  Backend
```

## Features

- **Reverse Proxy**: Streams responses via `.pipe()` — zero buffering, constant memory usage
- **Round-Robin Load Balancing**: Cycles through backends, automatically skips unhealthy ones
- **Health Checks**: Background polling every 3s with automatic failover
- **Token Bucket Rate Limiter**: Redis-backed, atomic via Lua scripting, works across multiple gateway instances
- **Sliding Window Counter**: Second algorithm for comparison — smoother rate enforcement, rejects bursts sooner
- **Rate Limit Headers**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After` on every response
- **Fail-Open on Redis Failure**: If Redis goes down, traffic flows unmetered rather than blocking everything
- **Graceful Shutdown**: SIGTERM/SIGINT handler drains in-flight requests before exiting
- **Live Dashboard**: Real-time charts showing throughput, block rate, and backend health
- **Metrics Endpoint**: JSON counters at `/metrics`

## Why Native `http` Instead of Express?

Express adds routing, middleware chains, and body parsing — none of which a proxy needs. A proxy receives bytes and forwards bytes. Using `http.createServer()` + `.pipe()` directly means:

1. **No unnecessary overhead**: Express parses request bodies by default. A proxy shouldn't touch the body at all.
2. **Transparent streaming**: `.pipe()` connects the client stream directly to the backend stream. Express middleware would buffer the response, defeating the purpose.
3. **Fewer dependencies**: The gateway has exactly 1 production dependency (`ioredis`).

## Why Lua for Rate Limiting?

The rate limiter needs to **read** the current token count, **check** if a token is available, and **write** the updated count — all as one indivisible operation.

If done in JavaScript:
```javascript
const tokens = await redis.hget(key, 'tokens');  // Read: tokens = 1
// ⚠️ Another request reads tokens = 1 here!
if (tokens >= 1) {
  await redis.hset(key, 'tokens', tokens - 1);   // Both requests get through
}
```

Two concurrent requests could both read `tokens = 1` and both succeed — a **race condition**. Redis executes Lua scripts atomically (no other command can interleave), so the entire read-check-write happens as one operation.

## Token Bucket vs Sliding Window

| Property | Token Bucket | Sliding Window |
|---|---|---|
| Burst tolerance | Allows bursts up to capacity | Smoother, rejects bursts sooner |
| Refill behavior | Continuous (tokens/sec) | Per-window reset |
| State complexity | 2 fields (tokens, lastRefill) | 3 fields (prevCount, currCount, windowStart) |
| Best for | APIs that tolerate short bursts | APIs needing strict rate enforcement |

## Fail-Open vs Fail-Closed

**Our choice: Fail-Open.** If Redis goes down, the gateway allows all traffic through unmetered.

**Rationale**: This gateway sits in front of our own backends. A complete traffic block (fail-closed) would cause an outage for all users. Unmetered traffic might overload backends temporarily, but they'll recover once Redis comes back. Availability > correctness for this use case.

## Quick Start

### Prerequisites
- Node.js 18+
- Redis running on localhost:6379

### Install & Run

```bash
# Install dependencies
npm install

# Terminal 1: Start mock backends
npm run start:backends

# Terminal 2: Start the gateway
npm run start

# Terminal 3: Test it
curl http://localhost:8080/
```

### Endpoints

| Endpoint | Description |
|---|---|
| `http://localhost:8080/` | Proxied to backends (round-robin) |
| `http://localhost:8080/metrics` | JSON metrics snapshot |
| `http://localhost:8080/dashboard` | Live monitoring dashboard |

### Run Benchmarks

```bash
# Single instance benchmark
npm run bench

# Two-instance distributed rate limiter test
npm run bench:two
```

### Switch Rate Limiting Algorithm

Edit `src/config.js`:
```javascript
rateLimit: {
  algorithm: 'sliding-window',  // or 'token-bucket'
}
```

## Two-Instance Distributed Test

To prove rate limit state is shared via Redis:

1. Run two gateway instances on ports 8080 and 8081
2. Exhaust the rate limit by sending 15 rapid requests to instance A
3. Immediately send requests to instance B with the same IP
4. Instance B rejects them with 429 — proving the token bucket is shared through Redis, not stored in process memory

Round-robin indices are **not** shared (each instance has its own counter) — this is correct and expected, only rate-limit state needs to be distributed.

## Project Structure

```
api-gateway/
├── backends/
│   └── mock-server.js          # 3 mock backend servers with /health toggle
├── src/
│   ├── server.js               # Entry point — wires everything together
│   ├── proxy.js                # Request forwarding with streaming
│   ├── loadBalancer.js         # Round-robin with health-check awareness
│   ├── healthCheck.js          # Background health polling
│   ├── metrics.js              # In-memory counters
│   ├── shutdown.js             # Graceful shutdown handler
│   ├── config.js               # Central configuration
│   ├── dashboard.html          # Live monitoring UI
│   └── rateLimiter/
│       ├── tokenBucket.js      # Token bucket JS wrapper
│       ├── tokenBucket.lua     # Atomic Lua script
│       ├── slidingWindow.js    # Sliding window JS wrapper
│       └── slidingWindow.lua   # Atomic Lua script
├── benchmarks/
│   ├── run-single-instance.js  # autocannon load test
│   └── run-two-instance.js     # Distributed rate limiter proof
├── package.json
└── README.md
```

## License

MIT
