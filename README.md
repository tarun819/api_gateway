# API Gateway in Native Node.js

A production-oriented API Gateway built with native Node.js that demonstrates distributed rate limiting, request correlation tracing, sliding-window circuit breaking, health-aware load balancing, zero-copy stream forwarding, and graceful shutdown.

---

### 📊 Project Statistics

`~1,400 Lines of Code` | `14 Source Files` | `3 Lua Scripts` | `3 Mock Backends` | `3 Benchmark Suites` | `8 Reliability Features` | `2 Rate Limiting Algorithms`

---

## ⚡ Tech Stack Summary

* **Runtime & Networking**: Native Node.js (`http`, `crypto`, `stream`)
* **Distributed State**: Redis + Atomic Lua Scripts (`ZSET` concurrency locking, Token Bucket & Sliding Window)
* **Architecture**: Distributed Reverse Proxy, Load Balancer & Resiliency Pipeline
* **Load Testing**: Autocannon

---

## 🎯 Motivation

This project was built to explore core production gateway patterns used in enterprise systems such as NGINX, Envoy, and Spring Cloud Gateway. The primary focus was understanding low-level reliability, state synchronization, stream pipe safety, and fault-tolerance mechanisms rather than simply forwarding HTTP requests.

---

## 🚀 Key Production Features

* ✔ **Native HTTP Reverse Proxy**: Bypasses framework overhead (no Express) for high-performance stream routing.
* ✔ **Zero-Copy Stream Forwarding**: Uses Node.js Streams (`.pipe()`) to stream payloads with `O(1)` memory usage.
* ✔ **Atomic Redis Lua Rate Limiting**: Executes atomic read-check-write logic via custom Lua scripts.
* ✔ **Self-Healing Distributed Concurrency**: Tracks cluster-wide in-flight connections per IP via Redis Sorted Sets (`ZSET`).
* ✔ **Lease Renewal Heartbeat Pattern**: Refreshes `ZSET` scores at 70% of lease timeout so long-lived streaming/upload requests aren't prematurely evicted.
* ✔ **Hystrix-Style Circuit Breaker**: Rolling-window state machine (`CLOSED` → `OPEN` → `HALF_OPEN`) with single-probe thundering herd protection.
* ✔ **Health-Aware Round Robin**: Continuously polls upstream `/health` endpoints and skips unhealthy backends.
* ✔ **Distributed Request Tracing**: Propagates `X-Request-Id` correlation UUIDs across all logs and downstream responses.
* ✔ **Fail-Fast & Fail-Open Resilience**: Bypasses Redis during outages (`enableOfflineQueue: false`) to keep traffic flowing.
* ✔ **Kubernetes-Ready Graceful Shutdown**: Drains in-flight connections safely on `SIGINT` / `SIGTERM`.
* ✔ **Live Observability Metrics**: Exposes low-latency JSON metrics at `/metrics`.
* ✔ **Automated Benchmark Suite**: Includes single-node load tests, multi-node clustering tests, and state machine lifecycle tests.

---

## 🏗️ Architecture & Request Lifecycle

```
                                  ┌─────────────────────────────────────────────────────────┐
                                  │                   API Gateway (:8080)                   │
  Client ───────────────────────► │                                                         │
  (X-Request-Id: UUID v4)        │  ┌──────────────────┐  ┌─────────────────────────────┐  │
                                  │  │   Request ID     │  │    Distributed Concurrency  │  │
                                  │  │   Correlation    │  │    Limiter (Redis ZSET)    │  │
                                  │  └────────┬─────────┘  └──────────────┬──────────────┘  │
                                  │           │                           │                 │
                                  │  ┌────────▼─────────┐  ┌──────────────▼──────────────┐  │
                                  │  │   Rate Limiter   │  │       Circuit Breaker       │  │
                                  │  │(Token Bucket Lua)│  │ (Sliding Window 50% Rate)   │  │
                                  │  └────────┬─────────┘  └──────────────┬──────────────┘  │
                                  │           │                           │                 │
                                  │  ┌────────▼─────────┐  ┌──────────────▼──────────────┐  │
                                  │  │In-Memory Metrics │  │    Load Balancer (Round    │  │
                                  │  │  (Observability) │  │    Robin + Health Check)    │  │
                                  │  └──────────────────┘  └──────────────┬──────────────┘  │
                                  └───────────┼───────────────────────────┼─────────────────┘
                                              │                           │
                                       ┌──────▼──┐             ┌──────────┼──────────┐
                                       │  Redis  │             │          │          │
                                       │ (State) │             ▼          ▼          ▼
                                       └─────────┘           :4001      :4002      :4003
                                                            Backend    Backend    Backend
```

### Request Processing Flow
1. **Request Entry**: Client hits the gateway endpoint.
2. **Tracing**: `X-Request-Id` UUID is attached to the request headers (or reused if sent by the client) and added to the outgoing response.
3. **Distributed Concurrency Limiter**: Checks Redis `ZSET` to admit or reject based on active in-flight requests from the client's IP.
4. **Rate Limiter**: Executes an atomic Redis Lua script (Token Bucket or Sliding Window) to evaluate quota.
5. **Circuit Breaker & Load Balancer**: The Round-Robin balancer checks `circuitBreaker.canRoute()` and health check status before selecting an available backend.
6. **Transparent Proxying**: Request data is streamed directly to the upstream backend using Node.js Streams (`.pipe()`).
7. **Circuit State Updates**: Upstream response status (2xx/3xx/4xx vs 5xx) or socket errors update the backend's circuit breaker state.
8. **Metrics Update**: Traffic counts, blocked requests, and backend distribution counters are updated in-memory.

---

## 🧠 Interesting Engineering Problems Solved (Interview Highlights)

* **Prevented Race Conditions via Atomic Lua Scripting**: Replaced multi-step JS read/write calls with atomic Lua scripts executed single-threaded in Redis, eliminating TOCTOU (time-of-check to time-of-use) race conditions across clustered gateways.
* **Cached Lua Scripts via `EVALSHA`**: Pre-registered Lua scripts on startup using `ioredis.defineCommand`, allowing execution via SHA hashes (`EVALSHA`) to avoid transmitting raw script text over the network on every request.
* **Lease Renewal Heartbeat for Long-Running Requests**: Implemented a background renewal timer running at 70% of lease timeout (`leaseTimeoutMs * 0.7`) to execute `ZADD` timestamp updates for long-lived streams/uploads. This prevents active connections from being evicted as "stale" while retaining self-healing properties if a gateway crashes.
* **Guaranteed Timer Cleanup on All Exit Paths**: Bound lease renewal timers to the HTTP response `'close'` event, ensuring that successful finishes, 5xx errors, and aborted client sockets all cleanly stop the timer and release the concurrency slot without memory leaks.
* **Solved Stream Hanging Caused by Async Middleware Gaps**: Fixed a subtle Node.js stream trap where `GET` requests without a body emit `'end'` during `await` gaps. Added `if (clientReq.complete) proxyReq.end()` to prevent socket stalls.
* **Self-Healing Distributed Concurrency Leases**: Used Redis Sorted Sets (`ZSET`) with timestamp scores instead of raw `INCR`/`DECR` counters so crashed gateway processes automatically have their stale leases reclaimed by `ZREMRANGEBYSCORE`.
* **Prevented Thundering Herd During Recovery**: Implemented a `probeInFlight` single-request lock in the `HALF_OPEN` circuit breaker state to ensure only one test request probes a recovering backend before allowing full traffic.
* **Fail-Open Resilience for Redis Outages**: Configured Redis with `enableOfflineQueue: false` and `maxRetriesPerRequest: 1` so that database connection drops trigger instant fail-open fallbacks rather than freezing HTTP socket connections.
* **Separated Observability Data from Correctness State**: Stored `/metrics` counters in-memory instead of Redis. Metrics are observability data rather than correctness-critical distributed state; storing them in Redis would introduce unnecessary network latency and write amplification.
* **Distributed End-to-End Tracing**: Propagated `X-Request-Id` UUID correlation headers seamlessly across HTTP client requests, gateway log events, and backend microservice headers.

---

## ⏱️ Algorithmic & System Complexity

| Component | Operations / Data Structure | Time Complexity | Space Complexity |
|---|---|---|---|
| **Load Balancer** | Round-Robin Pointer Array | `O(1)` | `O(N)` backends |
| **Rate Limiter** | Redis Atomic Lua Script | `O(1)` | `O(U)` active IPs |
| **Concurrency Limiter** | Redis `ZSET` (Timestamp Score) | `O(log K)` | `O(K)` active connections |
| **Circuit Breaker** | Ring Buffer Array + Running Sum | `O(1)` | `O(N)` backends |
| **Proxy Engine** | Node.js Stream Piping (`.pipe()`) | `O(1)` | `O(1)` memory (bounded) |

---

## ⚡ Circuit Breaker State Machine

```
              ┌─────────────────────────────────────────┐
              │                                         │
              ▼                                         │ 500/502/503/504
        ┌───────────┐     Failure Rate ≥ 50%    ┌──────┴────┐  or Network Error
        │  CLOSED   ├──────────────────────────►│    OPEN   │
        └─────▲─────┘    (in 10-req window)     └─────┬─────┘
              │                                       │
              │ Probe                                 │ 2s Cooldown
              │ Succeeded                             │ Expired
              │                                 ┌─────▼──────┐
              └─────────────────────────────────┤ HALF_OPEN  │
                                                └────────────┘
                                                (Single Probe)
```

---

## 🛡️ Failure Handling & Resiliency Matrix

| Scenario | Gateway Behavior | Impact |
|---|---|---|
| **Redis Unavailable** | `enableOfflineQueue: false` triggers fail-open strategy | Gateway immediately permits traffic unmetered instead of hanging HTTP socket connections |
| **Backend Unreachable** | Socket connection times out after 2000ms | Returns `502 Bad Gateway` and records failure on circuit breaker |
| **Backend Intermittent 5xx Errors** | Circuit Breaker trips `OPEN` after 50% failure rate | Gateway immediately returns `503 Service Unavailable` to let backend recover |
| **Gateway Process Crash** | Concurrency `ZSET` leases expire automatically after 30s | Prevents orphaned counter leaks across the cluster |
| **Gateway Shutdown (`SIGTERM`)** | Stops accepting connections & waits up to 10s for in-flight requests | Prevents broken connections (`ECONNRESET`) for downstream clients |

---

## 📐 Deep-Dive Architectural Insights

### 1. Health Checks vs. Circuit Breakers: Why Both are Necessary
* **Proactive Health Check Polling**: Background health checks poll backend `/health` endpoints periodically (e.g. every 3s). This catches known down instances *before* client traffic hits them.
* **Reactive Circuit Breakers**: Real-time circuit breakers evaluate failure rates on live production traffic. If a backend suddenly starts throwing 500 errors or timing out under load, the circuit breaker trips to `OPEN` instantly—protecting the system long before the next 3-second health check cycle runs.

### 2. Why Redis `ZSET` Was Chosen for Concurrency Limiting
Redis Sorted Sets (`ZSET`) were chosen because they naturally support timestamp-based ordering, efficient expiration of stale leases via `ZREMRANGEBYSCORE`, and constant-time cardinality queries (`ZCARD`). This makes them ideal for self-healing distributed concurrency tracking without requiring external garbage-collection cron jobs.

### 3. Stream Pipe Safety with Async Middleware
When handling `async/await` operations (like Redis queries) before forwarding requests, incoming `GET` requests without a body can finish receiving data before `proxy.forward()` is called. Without an explicit check, `clientReq.pipe(proxyReq)` misses the `'end'` event and hangs indefinitely. We guard against this by checking `if (clientReq.complete) proxyReq.end()`.

### 4. Why Metrics are Stored In-Memory
Metrics are intentionally stored in-memory because they represent observability data rather than correctness-critical distributed state. Replicating metrics through Redis would add unnecessary network latency and write amplification to the core request pipeline.

### 5. Lease Renewal Heartbeat Pattern for Long-Running Requests
To support long-lived HTTP requests (e.g. streaming responses, SSE, large file uploads), the gateway implements a heartbeat timer running at 70% of lease timeout (`leaseTimeoutMs * 0.7`). It calls `distributedConcurrency.renew(ip, requestId)` to execute a `ZADD` timestamp update in Redis. This resets the eviction countdown for active requests while retaining self-healing properties: if the gateway crashes, the heartbeat stops and `ZREMRANGEBYSCORE` reaps the slot after 30 seconds.

---

## 📊 Benchmark & Performance Analysis

Single-instance benchmark results generated via `autocannon` (10-second duration per concurrency level).

> **Rate Limit & Concurrency Note**: Under default config (`maxConcurrent: 5`, `capacity: 10`), requests exceeding quota from `127.0.0.1` are blocked with `429 Too Many Requests` (accounting for both concurrency and token bucket limits). The table below demonstrates 100% socket stability under heavy burst traffic without connection drops.

### Benchmark Data (Single Instance `:8080`)

| Connections | Throughput (req/sec) | Latency p50 | Latency p97.5 | Latency p99 | 2xx Allowed | 429 Blocked | Socket Success Rate |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **10** | 1,591 req/s | 6.0 ms | 11.0 ms | 15.0 ms | 29 | 15,876 | 100% (0 errors) |
| **50** | 2,360 req/s | 18.0 ms | 35.0 ms | 43.0 ms | 21 | 23,574 | 100% (0 errors) |
| **100** | 2,413 req/s | 37.0 ms | 69.0 ms | 166.0 ms | 0 | 24,124 | 100% (0 errors) |

---

## 📸 Visual Demos & Terminal Outputs

```
+-------------------------------------------------------------------------------+
|                       API GATEWAY BENCHMARK DEMO                              |
+-------------------------------------------------------------------------------+
| $ npm run bench:circuit                                                       |
|                                                                               |
|   Circuit Breaker Lifecycle Test                                              |
|   Step 1: Normal Traffic (CLOSED) -> ✓ [200] Backend is healthy               |
|   Step 2: Kill Backend -> Trip to OPEN -> ✓ [503] Circuit is OPEN, instant 503|
|   Step 3: Cooldown -> Failed Probe (HALF_OPEN -> OPEN)                        |
|   Step 4: Restart Backend -> Probe Succeeded (HALF_OPEN -> CLOSED)             |
|                                                                               |
|   ✅ PASSED: CLOSED -> OPEN -> HALF_OPEN -> OPEN -> HALF_OPEN -> CLOSED       |
+-------------------------------------------------------------------------------+
```

---

## 🚀 Quick Start & How to Run

### Prerequisites
* **Node.js**: v18+
* **Redis**: Running on `localhost:6379` (via WSL, Docker, or native service)

### 1. Start Background Services

```bash
# Terminal 1: Start Redis Server (WSL / Docker)
redis-server

# Terminal 2: Start Mock Backends (Ports 4001, 4002, 4003)
npm run start:backends
```

### 2. Run the API Gateway

```bash
# Terminal 3: Start the Gateway (Port 8080)
npm run start
```

---

## 🧪 Benchmark & Automated Test Suite

Run these commands from your project root:

```bash
# 1. Single-Instance Load Test (Requires Gateway, Backends, and Redis running)
npm run bench

# 2. Clustered Multi-Gateway Test (Requires Backends and Redis running)
# Spawns two gateways (8080 & 8081) to verify shared rate limit state
npm run bench:two

# 3. Circuit Breaker Lifecycle Test (Self-contained, spawns its own mock backend)
# Tests CLOSED -> OPEN -> HALF_OPEN probe -> CLOSED recovery flow
npm run bench:circuit
```

---

## 🔮 Future Work & Architecture Roadmap

* 🔹 **Consistent Hashing**: Sticky sessions and stateful routing via Ketama hashing.
* 🔹 **Least Connections Balancing**: Dynamic load balancing based on active upstream connection counts.
* 🔹 **Prometheus Observability**: Exporting metrics in official Prometheus exposition format (`/metrics` text format).
* 🔹 **JWT Authentication & Authorization**: Stateless JWT verification at the edge before proxying.
* 🔹 **OpenTelemetry Tracing**: Distributed context propagation using W3C Trace Context headers.
* 🔹 **Dynamic Service Discovery**: Integrating with etcd or Consul for zero-downtime registration.
* 🔹 **Retry with Exponential Backoff**: Automatic retry policies for idempotent HTTP methods.

---

## ⚙️ Configuration (`src/config.js`)

```javascript
module.exports = {
  gatewayPort: 8080,
  backends: [
    { host: '127.0.0.1', port: 4001 },
    { host: '127.0.0.1', port: 4002 },
    { host: '127.0.0.1', port: 4003 },
  ],
  rateLimit: {
    algorithm: 'token-bucket', // 'token-bucket' or 'sliding-window'
    capacity: 10,
    refillRate: 2,
  },
  distributedConcurrency: {
    enabled: true,
    maxConcurrent: 5,
    leaseTimeoutMs: 30000,
  },
  circuitBreaker: {
    windowSize: 10,
    failureRateThreshold: 0.5,
    cooldownMs: 2000,
  },
};
```

---

## 📂 Project Structure

```
api_gateway/
├── backends/
│   └── mock-server.js               # 3 mock backends (Ports 4001-4003)
├── src/
│   ├── server.js                    # Core HTTP server & pipeline orchestrator
│   ├── proxy.js                     # Low-level streaming reverse proxy (.pipe())
│   ├── loadBalancer.js              # Round-robin router with Circuit Breaker awareness
│   ├── circuitBreaker.js            # Hystrix-style state machine (CLOSED, OPEN, HALF_OPEN)
│   ├── healthCheck.js               # Background health checker polling /health
│   ├── metrics.js                   # In-memory observability metrics counter
│   ├── shutdown.js                  # SIGINT/SIGTERM graceful shutdown handler
│   ├── config.js                    # Centralized system configuration
│   └── rateLimiter/
│       ├── distributedConcurrency.js # Redis ZSET concurrency limiter wrapper
│       ├── distributedConcurrency.lua# Self-healing atomic Lua script for concurrency
│       ├── tokenBucket.js           # Token bucket JS wrapper
│       ├── tokenBucket.lua          # Atomic Lua script for Token Bucket
│       ├── slidingWindow.js         # Sliding window JS wrapper
│       └── slidingWindow.lua        # Atomic Lua script for Sliding Window
├── benchmarks/
│   ├── run-single-instance.js       # Autocannon performance benchmark
│   ├── run-two-instance.js          # Clustered multi-gateway distributed test
│   └── run-circuit-breaker.js       # State machine lifecycle verification script
├── package.json
└── README.md
```
