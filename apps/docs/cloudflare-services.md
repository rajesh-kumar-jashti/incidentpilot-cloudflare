# Cloudflare Services — Technology Decision Document

## Cloudflare Workers

**Role:** API runtime, request routing, security enforcement

**Why:** Workers are the only Cloudflare runtime that can bind to Durable Objects, Workflows, R2, Vectorize, and Workers AI simultaneously. The edge-native execution model eliminates the need for a separate server, reduces cold-start latency, and provides built-in DDoS protection.

**Alternatives considered:**
- Node.js on a VPS: would require managing infrastructure, no native bindings to Cloudflare primitives
- Cloudflare Pages Functions: limited to GET/POST, no Durable Object bindings for WebSocket upgrade

---

## Cloudflare Workers AI

**Role:** LLM inference for incident classification, RCA generation, and agent tool calling

**Model:** `@cf/meta/llama-3.3-70b-instruct-fp8-fast`

**Why:** Workers AI runs inference within Cloudflare's network, eliminating external API dependencies. The Llama 3.3 70B model supports function/tool calling natively. FP8 quantization provides ~4x throughput improvement vs FP16 without meaningful accuracy loss for structured reasoning tasks.

**Alternatives considered:**
- OpenAI GPT-4: excellent but requires external API, adds latency, and violates the "Cloudflare-native" requirement
- Anthropic Claude: same issue — external dependency
- Smaller models (Llama 3.2 8B): insufficient reasoning for multi-step RCA with tool orchestration

---

## Cloudflare Agents SDK (`agents` package)

**Role:** Stateful AI agent framework

**Why:** The Agents SDK provides the base class for Durable Object-backed agents, handling WebSocket lifecycle, state synchronization, and protocol messages. It eliminates the need to manually implement reconnection and state recovery.

**Alternatives considered:**
- LangChain: adds significant complexity and external dependencies
- Raw Durable Object: viable but requires implementing all agent primitives manually

---

## Cloudflare Workflows

**Role:** Durable, multi-step investigation orchestration

**Why:** Workflows provide automatic durability — each step is checkpointed. If a Worker is killed mid-investigation, the workflow resumes from the last completed step. The `waitForEvent` primitive implements human-in-the-loop approval without custom polling infrastructure.

**Critical advantage:** Without Workflows, the investigation would be lost on any transient failure. A single long-running fetch handler cannot survive >30s Worker CPU limits.

**Alternatives considered:**
- Durable Objects with custom state machine: would require implementing step checkpointing, retry logic, and event waiting from scratch
- External workflow engines (Temporal, AWS Step Functions): breaks Cloudflare-native requirement and adds external dependencies

---

## Durable Objects

**Role:** Strongly-consistent per-incident state + real-time WebSocket broadcast

**Why:** The Incident Durable Object is the source of truth for all incident state. Its single-threaded execution model guarantees that concurrent approval requests, agent messages, and workflow events don't create race conditions. The SQLite storage provides relational state without the need for an external database.

**Why not KV or R2 for incident state?**
- KV: Eventually consistent — not acceptable for approval state
- R2: No SQLite, no WebSockets, not designed for real-time state

**Alternatives considered:**
- External database (PostgreSQL): requires network calls, adds latency, breaks edge-native model
- Cloudflare KV: Eventual consistency is a dealbreaker for approval/remediation state

---

## R2

**Role:** Incident report artifact storage

**Why:** Durable Objects SQLite has per-object storage limits and is optimized for structured state, not large document artifacts. R2 provides unlimited object storage with S3-compatible API. Reports stored in R2 survive DO eviction and can be directly served or downloaded.

**Alternatives considered:**
- DO SQLite: would hit size limits for large reports with full evidence
- External S3: viable but adds dependency, latency, and egress costs

---

## Vectorize

**Role:** Semantic incident memory for similar-incident retrieval

**Why:** Keyword search misses semantically similar incidents with different terminology (e.g., "connection pool exhaustion" vs "DB connections maxed out"). Vectorize stores embeddings of incident summaries and retrieves the most semantically similar past incidents, enabling the agent to leverage institutional memory.

**Implementation:** Falls back gracefully to `LocalMemoryRepository` (keyword-based) in local development where Vectorize may not be configured.

**Alternatives considered:**
- Cloudflare KV with manual text index: keyword-only, misses semantic similarity
- External vector DB (Pinecone, Weaviate): external dependency, higher latency, breaks Cloudflare-native model
- In-memory similarity: lost on Worker restart, not persistent

---

## Summary Table

| Service | Role | Why Cloudflare-native |
|---------|------|----------------------|
| Workers | API + routing | Direct binding to all other services |
| Workers AI | LLM inference | No external API required |
| Agents SDK | Stateful agent | Built-in DO state + WebSocket |
| Workflows | Durable orchestration | Step checkpointing + waitForEvent |
| Durable Objects | Consistent state + WebSocket | Single-threaded, SQLite, real-time |
| R2 | Report artifacts | S3-compatible, unlimited scale |
| Vectorize | Semantic memory | Native embedding search |
