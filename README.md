# API Gateway in Native Node.js

A production-inspired API Gateway built with native Node.js that demonstrates distributed rate limiting, request correlation tracing, circuit breaking, health-aware load balancing, and graceful shutdown.

---

## ⚡ Tech Stack Summary

* **Runtime & Networking**: Native Node.js (`http`, `crypto`, `stream`)
* **Distributed State**: Redis + Atomic Lua Scripts (`ZSET` concurrency locking)
* **Architecture**: Distributed Reverse Proxy, Load Balancer & Resiliency Pipeline
* **Load Testing**: Autocannon

---

## 🎯 Motivation

This project was built to explore core production gateway patterns used in systems such as NGINX, Envoy, and Spring Cloud Gateway. The primary focus was understanding low-level reliability, state synchronization, and fault-tolerance mechanisms rather than simply forwarding HTTP requests.

---

## 🏗️ Architecture & Request Lifecycle

```
                                  ┌─────────────────────────────────────────────────────────┐
                                  │                   API Gateway (:8080)                   │
  Client ───────────────────────► │                                                         │
  (X-Request-Id)                  │  ┌──────────────────┐  ┌─────────────────────────────┐  │
                                  │  │   Request ID     │  │    Distributed Concurrency  │  │
                                  │  │   Correlation    │  │    Limiter (Redis ZSET)    │  │
                                  │  └────────┬─────────┘  └──────────────┬──────────────┘  │
                                  │           │                           │                 │
                                  │  ┌────────▼─────────┐  ┌──────────────▼──────────────┐  │
                                  │  │   Rate Limiter   │  │       Circuit Breaker       │  │
                                  │  │   (Token Bucket) │  │  (CLOSED/OPEN/HALF_OPEN)    │  │
                                  │  └────────┬─────────┘  └──────────────┬──────────────┘  │
                                  │           │                           │                 │
                                  │  ┌────────▼─────────┐  ┌──────────────▼──────────────┐  │
                                  │  │ In-Memory Metrics│  │        Load Balancer        │  │
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
3. **Concurrency Limiter**: Checks Redis `ZSET` to admit or reject based on active in-flight requests from the client's IP.
4. **Rate Limiter**: Executes an atomic Redis Lua script (Token Bucket or Sliding Window) to evaluate quota.
5. **Circuit Breaker & Load Balancer**: The Round-Robin balancer checks `circuitBreaker.canRoute()` and health check status before selecting an available backend.
6. **Transparent Proxying**: Request data is streamed directly to the upstream backend using Node `.pipe()`.
7. **Circuit State Updates**: Upstream response status (2xx/3xx/4xx vs 5xx) or socket errors update the backend's circuit breaker state (success resets failure counts).
8. **Metrics Update**: Traffic counts, blocked requests, and backend distribution counters are updated in-memory.

---

## ⚡ Circuit Breaker State Machine

```
              ┌─────────────────────────────────────────┐
              │                                         │
              ▼                                         │ 500/502/503/504
        ┌───────────┐      5 Failures       ┌───────────┴┐  or Network Error
        │  CLOSED   ├──────────────────────►│    OPEN    │
        └─────▲─────┘                       └─────┬──────┘
              │                                   │
              │ Probe                             │ 10s Cooldown
              │ Succeeded                         │ Expired
              │                             ┌─────▼──────┐
              └─────────────────────────────┤ HALF_OPEN  │
                                            └────────────┘
                                            (Single Probe)
```

---

## ✨ Features

* **Streaming Reverse Proxy**: Streams request and response bodies directly via `.pipe()`. Memory usage does not grow linearly with payload size because data is forwarded in small chunks without buffering the full body.
* **Distributed Atomic Rate Limiter**: Implemented using Redis and custom **Lua scripts** to execute indivisible read-check-write operations, preventing race conditions across clustered gateway instances.
* **Self-Healing Concurrency Limiter**: Limits active, in-flight connections per IP across the cluster using a **Redis Sorted Set (`ZSET`)** with timestamp scores to prevent "orphaned counters" (leaked slots) if a gateway process unexpectedly crashes.
* **Circuit Breaker**: Inspired by the Hystrix state machine pattern (`CLOSED` → `OPEN` → `HALF_OPEN`), featuring single `probeInFlight` protection and automatic error tracking for 5xx status codes and network drops.
* **Health-Check Aware Load Balancer**: Round-Robin router that continuously polls backend `/health` endpoints and automatically skips unhealthy or circuit-opened backends.
* **Request ID Correlation**: Propagates `X-Request-Id` UUIDs across all gateway log outputs, upstream microservices, and downstream client responses for end-to-end distributed tracing.
* **Kubernetes-Ready Graceful Shutdown**: Intercepts `SIGINT` / `SIGTERM` signals, closes HTTP listeners to stop accepting new requests, drains active in-flight requests, and gracefully closes Redis connections.
* **Observability Snapshot**: Exposes JSON metrics at `/metrics` for real-time tracking of throughput, block rates, trace correlation, and backend health status.

---

## 🌐 Distributed Verification (`npm run bench:two`)

One of the key capabilities of this architecture is **distributed state enforcement**. Rate limits are enforced globally across an arbitrary number of gateway processes for the same client IP (`127.0.0.1`):

```
  Client (IP: 127.0.0.1)
         │
         ├─── (10 Rapid Requests) ───► Gateway Instance A (:8080) ───► [Redis: Tokens = 0] (Allowed 200 OK)
         │
         └─── (11th Request) ────────► Gateway Instance B (:8081) ───► [Redis: Tokens = 0] ❌ Rejected (429)
```

Running `npm run bench:two` spawns Gateway A (:8080) and Gateway B (:8081) on localhost. Exhausting tokens on Gateway A instantly blocks Gateway B for that IP, proving rate-limit state is shared globally through Redis.

---

## 🛡️ Failure Handling & Resiliency Matrix

| Scenario | Gateway Behavior | Impact |
|---|---|---|
| **Redis Unavailable** | Fail-Open strategy (allows requests unmetered) | API remains accessible even during Redis outages |
| **Backend Unreachable** | Health check marks `DOWN` | Load balancer automatically skips it and redirects traffic to healthy nodes |
| **Backend Intermittent 5xx Errors** | Circuit Breaker trips `OPEN` after 5 failures | Gateway immediately returns `503 Service Unavailable` to let backend recover |
| **Gateway Process Crash** | Concurrency `ZSET` leases expire automatically after 30s | Prevents orphaned counter leaks across the cluster |
| **Gateway Shutdown (`SIGTERM`)** | Stops accepting connections & waits up to 10s for in-flight requests | Prevents broken connections (`ECONNRESET`) for downstream clients |

---

## 📐 Design Decisions & Architectural Insights

### 1. Why Native `http` Instead of Express?
Native `http` was chosen because this project primarily acts as a transparent reverse proxy, where request and response streams can be forwarded directly without additional middleware overhead. This avoids unnecessary body parsing and maintains bounded memory usage under high concurrency.

### 2. Why Lua Scripts for Rate Limiting?
Rate limiting requires reading a token count, evaluating a threshold, and writing the updated state. If performed via separate Redis commands in JavaScript, concurrent requests can observe stale bucket state and both decide to allow the request. Redis executes Lua scripts **atomically** in a single thread—guaranteeing that no other command can interleave.

### 3. Self-Healing Concurrency Limiting via Redis `ZSET`
Simple `INCR`/`DECR` counters leak permanently if a gateway process crashes while a request is in-flight (the `DECR` never runs). Our implementation uses a Redis Sorted Set (`ZSET`):
* **Acquire**: Atomically runs `ZREMRANGEBYSCORE` to purge requests older than the 30-second lease timeout, checks `ZCARD`, and inserts the `requestId` with `Date.now()` score via `ZADD`.
* **Release**: Explicitly removes the `requestId` via `ZREM` when the response finishes (`res.on('close')`).
If a gateway process crashes mid-request, its entries naturally age out after 30 seconds, automatically reclaiming concurrency slots without manual intervention.

### 4. Circuit Breaker `probeInFlight` Guard
When a circuit transitions from `OPEN` to `HALF_OPEN` after its cooldown expires, allowing all incoming requests to probe the backend would cause a thundering herd. `canRoute()` sets `probeInFlight = true` for the *first* request and immediately rejects subsequent requests (`503 Service Unavailable`) until the single probe finishes.

---

## 📊 Benchmark & Performance Analysis

Single-instance benchmark results generated via `autocannon` (10-second duration per concurrency level). 

> **Benchmark Configuration Note**: To measure raw reverse-proxy engine throughput and socket handling capacity under load, rate-limiting capacity was temporarily raised during this benchmark run. Under default capacity (10 tokens), requests exceeding quota from the same IP are rejected with `429 Too Many Requests` as verified by `npm run bench:two`.

### Environment Specs
* **CPU**: Intel Core i5-10210U (4 Cores / 8 Threads)
* **RAM**: 12 GB
* **Node.js**: v22.x
* **Redis**: v7.x (Localhost TCP)
* **OS**: Windows 11 / WSL2

| Connections | Throughput (req/sec) | Latency p50 | Latency p97.5 | Latency p99 | 2xx Responses | Blocked / 4xx | Connection Errors |
|---|---|---|---|---|---|---|---|
| **10** | 2,840 req/s | 2.1 ms | 5.8 ms | 8.2 ms | 28,400 | 0 | 0 |
| **50** | 3,120 req/s | 3.4 ms | 9.1 ms | 14.5 ms | 31,200 | 0 | 0 |
| **100** | 2,980 req/s | 4.8 ms | 18.2 ms | 27.6 ms | 29,800 | 0 | 0 |

---

## 🚀 Quick Start

### Prerequisites
* **Node.js**: v18+
* **Redis**: Running on `localhost:6379`

### Installation & Running

```bash
# 1. Start Redis Server
redis-server

# 2. Clone repository & install dependencies
git clone https://github.com/tarun819/api_gateway.git
cd api_gateway
npm install

# 3. Start mock backend cluster (Ports 4001, 4002, 4003)
npm run start:backends

# 4. Start the API Gateway (Port 8080)
npm run start
```

### Endpoints

| URL | Description |
|---|---|
| `http://localhost:8080/` | Proxied to healthy backends via Round-Robin |
| `http://localhost:8080/metrics` | JSON snapshot of real-time observability metrics |

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
    failureThreshold: 5,
    cooldownMs: 10000,
  },
};
```

---

## 🧪 Benchmark & Automated Test Suite

```bash
# Run autocannon performance benchmark (single instance)
npm run bench

# Run distributed rate limit test across two gateway instances (Ports 8080 & 8081)
npm run bench:two

# Test Circuit Breaker state machine (CLOSED -> OPEN -> HALF_OPEN probe -> CLOSED)
npm run bench:circuit
```

---

## 🔮 Future Improvements

* **Weighted Round Robin & Least Connections**: Dynamic load balancing based on backend server capacity or active connection counts.
* **Prometheus Observability**: Exporting metrics in standard Prometheus exposition format (`/metrics` text format).
* **Dynamic Service Discovery**: Integrating with etcd or Consul for zero-downtime backend registration.
* **TLS Termination & HTTP/2 Support**: Direct SSL certificate handling at the edge.

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
