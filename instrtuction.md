# API Gateway with Load Balancer + Distributed Rate Limiter
### Build specification for Antigravity — Node.js / Redis / Lua

---

## 0. What we are building (give this to Antigravity as the project brief)

A production-inspired API Gateway in Node.js that sits in front of multiple backend
servers. It does four things:

1. **Reverse proxies** requests using Node's native `http` module (no Express).
2. **Load balances** across backends using Round-Robin, skipping unhealthy ones.
3. **Rate limits** per client IP using a Token Bucket algorithm, with bucket state
   stored in Redis (not in-memory) so the limiter works correctly across multiple
   gateway instances. A second algorithm, Sliding Window Counter, is implemented
   for comparison.
4. **Exposes metrics** (requests handled, requests blocked, traffic per backend,
   backend health) and is **load tested** with autocannon, including a two-instance
   test that proves the rate limiter state is actually shared via Redis.

Resume pitch (for reference, don't paste into code):
> Built a distributed API gateway in Node.js using native HTTP APIs, implementing
> round-robin load balancing with health checks and a Redis-backed token bucket
> rate limiter made atomic via Lua scripting. Verified distributed correctness
> across multiple gateway instances and benchmarked throughput/latency under load.

---

## 1. Tech stack

- Node.js, native `http` module only (no Express, no Fastify)
- Redis (via `ioredis` or `redis` npm client — pick one, don't use both)
- Lua (embedded in Redis via `EVAL`/`EVALSHA`)
- `autocannon` for load testing
- Plain JS is fine; TypeScript optional and not worth the setup time given your timeline

---

## 2. Repo structure

```
api-gateway/
├── backends/
│   └── mock-server.js          # spins up N mock backend servers with /health
├── src/
│   ├── server.js                # entry point — starts the gateway
│   ├── proxy.js                 # core request forwarding + streaming
│   ├── loadBalancer.js          # round-robin logic + backend list
│   ├── healthCheck.js           # background health polling
│   ├── rateLimiter/
│   │   ├── tokenBucket.js       # token bucket, calls Lua script
│   │   ├── tokenBucket.lua      # atomic Lua script
│   │   ├── slidingWindow.js     # second algorithm
│   │   └── slidingWindow.lua
│   ├── metrics.js               # in-memory counters + /metrics endpoint
│   └── config.js                # backend list, ports, limits — all in one place
├── benchmarks/
│   ├── run-single-instance.js
│   └── run-two-instance.js
├── README.md
└── package.json
```

Tell Antigravity to create this structure **before** writing any logic, so you
always know which file you're looking at.

---

## 3. Do's and Don'ts for working with Antigravity

This is the part that matters most for your interviews. Nobody checks whether you
used AI. They check whether you can explain what the code does when they ask
"why did you do it this way" or "walk me through what happens when two requests
hit this at the same time." If you can't, the project is worthless regardless of
how well it runs.

**Do:**
- Build **one phase at a time**. Paste only that phase's section of this doc into
  Antigravity. Don't ask it to scaffold the entire project in one shot — you won't
  be able to trace what it did.
- After each file is generated, **read it line by line before running it.** If
  there's a line you don't understand, ask Antigravity "explain this line" before
  moving on, not after the whole project is done.
- After finishing each phase, **close the editor and explain the phase out loud**
  to yourself (or write one paragraph) without looking at the code. If you can't,
  you don't understand it yet — reread it.
- **Rewrite the Lua scripts yourself by hand** after Antigravity generates a
  working version. This is the single highest-value piece of code in the project
  for interviews — it needs to live in your head, not just your repo.
- Ask Antigravity to add comments explaining *why*, not *what* (e.g. why `EVAL`
  and not a GET-then-SET from Node — because that's two round trips and a race
  condition).
- Test each phase manually with `curl` before moving to the next phase.

**Don't:**
- Don't accept a dependency you can't name the purpose of. If Antigravity adds a
  package you don't recognize, ask what it's for before installing it.
- Don't let it silently add Express "to make routing easier." The whole point of
  Phase 2 is the native `http` module. If it suggests a framework, decline.
- Don't let it build error handling you don't understand (e.g. generic try/catch
  wrappers everywhere). Ask what specific failure each catch block is guarding
  against.
- Don't move to the next phase until the current one actually runs and you've
  tested it. Debugging four unreviewed phases at once is how "AI-generated slop"
  happens.
- Don't let it merge the rate limiter and load balancer into one file "for
  simplicity." Keeping them separate is itself a talking point (separation of
  concerns: routing decision vs. admission decision).

---

## 4. Phases

### Phase 0 — Scaffolding
**Goal:** repo structure, `package.json`, install `ioredis` (or `redis`) and
`autocannon` as a dev dependency. Confirm Redis is running locally (`redis-cli ping`
→ `PONG`).
**Verify:** `node -e "require('ioredis')"` doesn't throw. Redis responds to ping.

### Phase 1 — Mock backend servers
**Goal:** `backends/mock-server.js` spins up 3 tiny HTTP servers (e.g. ports 4001,
4002, 4003), each responding to `GET /` with something identifying which port
answered (e.g. `{ backend: 4001 }`), and `GET /health` with `200 OK`. Add an env
var or endpoint to toggle one backend into a "down" state (e.g. `GET /toggle-health`
flips it to return 500 on `/health`) — you'll need this for Phase 4 and the
benchmark later.
**Why this matters:** without this you can't test load balancing or health checks
at all. Build and verify this before touching the gateway.
**Verify:** `curl localhost:4001/`, `curl localhost:4001/health`, toggle it and
confirm `/health` now fails.

### Phase 2 — Core proxy (native `http`, no Express)
**Goal:** `src/proxy.js` — the gateway listens on its own port (e.g. 8080),
receives a request, forwards it to a chosen backend (hardcode one backend for now,
load balancing comes next phase), and **streams** the backend's response back to
the client rather than buffering it fully in memory.
**Key concept you must be able to explain:** the difference between buffering a
response (`res.on('data', chunk => buffer.push(chunk))` then sending it all at
once) and streaming it (`.pipe()`ing the backend response directly into the client
response). Streaming means memory usage doesn't grow with response size and the
client starts receiving data sooner. Ask Antigravity to use Node's `http.request`
+ `.pipe()`, not manual buffering.
**Don't let it:** add Express, add body-parsing middleware you don't need for a
proxy, or buffer the response into a string before sending.
**Verify:** `curl localhost:8080/` returns the hardcoded backend's response.

### Phase 3 — Round-robin load balancing
**Goal:** `src/loadBalancer.js` maintains the list of backends and an index.
Each request picks `backends[index % backends.length]` then increments the index.
**Framing:** this is a plain counter, not an "atomic" operation — Node is
single-threaded, so nothing can interrupt the increment mid-execution. Don't let
Antigravity add locking or atomic-increment language here; it's unnecessary and
will make you look like you don't understand concurrency if you claim it in an
interview.
**Verify:** hit `localhost:8080/` five times in a row, confirm the backend field
in the response cycles through 4001 → 4002 → 4003 → 4001...

### Phase 4 — Health checks
**Goal:** `src/healthCheck.js` runs a background `setInterval` (every 30s, but use
a shorter interval like 3s while testing) that pings each backend's `/health`.
Maintain an in-memory status map (`{4001: 'up', 4002: 'down', ...}`). The load
balancer must skip backends marked `down` when picking the next one.
**Key concept:** this is a background loop decoupled from the request path —
health status is checked periodically, not on every request, because checking
health synchronously on every request would add latency to every single call.
**Verify:** use the `/toggle-health` endpoint from Phase 1 to kill one backend,
wait for the next health check cycle, confirm the gateway stops routing to it,
then bring it back and confirm it rejoins.

### Phase 5 — Token bucket rate limiter (the core of the project)
**Goal:** `src/rateLimiter/tokenBucket.lua` + `tokenBucket.js`.

Give Antigravity this exact algorithm spec, don't let it invent its own:
- Each client IP gets a bucket: `{tokens: N, lastRefill: timestamp}` stored as a
  Redis hash, key = `ratelimit:tokenbucket:<ip>`.
- Bucket has a max capacity (e.g. 10 tokens) and a refill rate (e.g. 2 tokens/sec).
- On each request: compute how many tokens should have been added since
  `lastRefill` based on elapsed time, cap at capacity, then check if ≥1 token is
  available. If yes, consume 1 token, allow the request. If no, reject with 429.
- **All of this — read, refill calculation, check, decrement, write — happens
  inside a single Lua script executed via Redis `EVAL`.** This is what makes it
  atomic. If you did this as separate Node.js calls (GET bucket, compute, SET
  bucket), two concurrent requests could both read the same "1 token left" state
  and both get allowed — a race condition. The Lua script runs as one indivisible
  operation on the Redis server, so there's no window for another request to
  interleave.
**You must be able to say this exact sentence and defend it:** "The race condition
exists because there's an await boundary between reading the bucket state and
writing it back in JavaScript. Redis executes Lua scripts atomically, so moving
the whole read-check-write sequence into the script closes that window."
**Do this yourself:** after Antigravity generates the Lua script, rewrite it from
scratch on paper/in a scratch file without looking, then compare. If you can't
reproduce the core logic, keep studying it before moving on — this is the
question that will actually get asked.
**Verify:** fire requests rapidly at an endpoint via `curl` in a loop, confirm you
start getting 429s once the bucket empties, and that they stop once tokens refill.

### Phase 6 — Sliding window counter (second algorithm)
**Goal:** `src/rateLimiter/slidingWindow.js` + `.lua`. Divide time into fixed
windows (e.g. 1-second buckets), count requests per window per IP, weight the
previous window's count by how much it overlaps the current sliding window.
**Key concept — be ready to compare the two:**
- Token bucket: allows bursts up to capacity, smooth refill, simple to reason
  about, slightly more generous to bursty clients.
- Sliding window: smoother rate enforcement, no large bursts possible, but needs
  to track more state (multiple windows) and is a bit more complex to implement
  correctly.
**Verify:** same burst test as Phase 5, but confirm the rejection pattern differs
— sliding window should reject bursts sooner than token bucket at the same
average rate.

### Phase 7 — Metrics endpoint
**Goal:** `src/metrics.js` maintains in-memory counters (total requests, requests
blocked by rate limiter, requests per backend, current health status per backend)
and exposes them at `GET /metrics` as JSON.
**Don't:** wire this into a full Prometheus/Grafana stack — that's scope creep for
this timeline. Plain JSON counters are enough to demonstrate observability as a
concept.
**Verify:** hit a few endpoints, then `curl localhost:8080/metrics` and confirm
counts match what you actually sent.

### Phase 8 — Benchmarking (single instance)
**Goal:** `benchmarks/run-single-instance.js` uses `autocannon` programmatically
(or document CLI commands) to hit the gateway at increasing concurrency levels.
Capture: throughput, latency percentiles, count of 429s, and behavior when you
kill a backend mid-run.
**Verify:** you have actual numbers — requests/sec, p50/p99 latency — to put in
your README. Not "it works," a table.

### Phase 9 — Two-instance distributed test (do not skip this)
**Goal:** run two gateway processes on different ports (e.g. 8080 and 8081),
both pointed at the same Redis instance. Hit instance A until its rate limiter
kicks in for a given IP, then immediately hit instance B with the same IP and
confirm it's *also* rate-limited — proving the bucket state is actually shared
through Redis, not per-process memory.
**Why this phase exists:** you're claiming "distributed rate limiter suitable for
multiple gateway instances" in your pitch. Without this test that's an
architectural intention, not a demonstrated fact. This phase is what makes the
claim true. Confirm round-robin indices are *not* shared (each instance keeps its
own) — that's correct and expected, only rate-limit state needs to be shared.
**Verify:** write down the exact sequence you ran and the result — this becomes a
paragraph in your README and a very concrete interview answer.

### Phase 10 — README
Write it yourself once everything works, using this structure: project pitch,
architecture diagram, why native `http` instead of Express, why Lua for
atomicity, token bucket vs sliding window comparison, benchmark results table,
two-instance test description and result, build/run instructions. Don't have
Antigravity write this — writing it yourself is a good forcing function to check
you can actually explain every part without the code in front of you.

---

## 5. Order of operations summary

Phase 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10. Don't parallelize or skip ahead
— each phase's verification step is also your own comprehension checkpoint.