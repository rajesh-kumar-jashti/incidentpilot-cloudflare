# 🚨 IncidentPilot — AI Incident Response Agent

> **Investigate production incidents with an AI agent that remembers, reasons, and remediates on Cloudflare.**

IncidentPilot is an enterprise-grade AI-powered Incident Response Agent built natively on the **Cloudflare Developer Platform**. It automates root cause analysis (RCA), collects real-time infrastructure telemetry, searches past incident memory using vector embeddings, orchestrates multi-step workflows with human-in-the-loop approvals, and executes controlled remediation.

---

## 🏗️ Cloudflare Platform Architecture

IncidentPilot leverages Cloudflare's serverless primitives as core building blocks:

```
                          ┌──────────────────────────┐
                          │   React 18 + Vite Web UI  │
                          └─────────────┬────────────┘
                                        │ (REST / WebSockets)
                                        ▼
                          ┌──────────────────────────┐
                          │    Cloudflare Worker     │
                          │   (Hono Routing Engine)  │
                          └──────┬───┬───┬───┬───────┘
                                 │   │   │   │
        ┌────────────────────────┘   │   │   └───────────────────────┐
        ▼                            ▼   ▼                           ▼
┌──────────────┐         ┌───────────────────┐               ┌──────────────┐
│ Cloudflare   │         │ Cloudflare        │               │ Cloudflare   │
│ Workflows    │         │ Durable Objects   │               │ Workers AI   │
│ (Multi-step  │         │ (Stateful Agent   │               │ (Llama 3.3   │
│ Engine)      │         │ & WebSockets)     │               │  & BGE Embed)│
└──────┬───────┘         └─────────┬─────────┘               └──────┬───────┘
       │                           │                                │
       ▼                           ▼                                ▼
┌──────────────┐         ┌───────────────────┐               ┌──────────────┐
│ Cloudflare R2│         │ Cloudflare KV     │               │ Cloudflare   │
│ (Post-Mortems│         │ (Short-Term Memory│               │ Vectorize    │
│ & Reports)   │         │ & Cache)          │               │ (Vector DB)  │
└──────────────┘         └───────────────────┘               └──────────────┘
```

### Core Cloudflare Services Used

- **Cloudflare Workers AI**: Powered by `@cf/meta/llama-3.3-70b-instruct` for reasoning and tool calling, and `@cf/baai/bge-large-en-v1.5` for generating 1024-dimensional embeddings of past post-mortems.
- **Cloudflare Durable Objects**: Provides single-writer consistency, real-time WebSocket state distribution, chat history management, and human-in-the-loop approval synchronization per incident (`IncidentAgent`).
- **Cloudflare Workflows**: Guarantees durable, resilient execution of multi-step incident investigations with automatic step retry, state persistence, and external human signal pausing (`IncidentInvestigationWorkflow`).
- **Cloudflare Vectorize**: High-performance vector database storing embedding vectors for instant semantic similarity search over historical incident post-mortems.
- **Cloudflare R2**: Object storage for immutable incident post-mortem reports, executive summaries, and generated timeline artifacts.
- **Cloudflare KV**: Low-latency key-value store for fast short-term incident caching, active session state, and service status tracking.

---

## ⚡ Key Features

- **🤖 Autonomous Multi-Step Incident Investigation**: Automatically triggered via webhooks (PagerDuty/Datadog/Prometheus format) or manually.
- **📊 Real-time Infrastructure Telemetry**: Queries simulated metrics, application logs, deployment history, and Cloudflare service health.
- **🧠 Hybrid Short-Term & Long-Term Memory**:
  - *Short-Term*: Active context and workspace session stored in Cloudflare KV / Durable Objects.
  - *Long-Term*: Post-mortem embeddings stored in Cloudflare Vectorize for historical incident retrieval.
- **🛡️ Human-in-the-Loop Remediation Approval**: High-risk actions (e.g., rolling back deployments, restarting database pools, purging cache) require explicit human approval via UI/WebSocket before execution.
- **📡 Real-Time Live Streaming Console**: Live step-by-step progress and interactive chat interface powered by WebSockets connected directly to Durable Objects.
- **📄 Automated Incident Reports**: Generates detailed markdown post-mortems stored permanently in Cloudflare R2.

---

## 🎯 Simulated Incident Scenarios

IncidentPilot includes built-in real-world incident simulations:

1. **DB Connection Pool Exhaustion**: High database response times, pool saturation, and spike in 500 error rates.
2. **API Gateway Latency Spike**: Microservice response degradation following a rogue deployment.
3. **Memory Leak & OOM**: Progressive RSS memory growth culminating in out-of-memory container crashes.
4. **Cloudflare Workers KV Cache Invalidation Failure**: Stale cache data causing inconsistent client state across edge locations.

---

## 📁 Repository Structure

```
.
├── apps/
│   ├── web/                    # React 18 + Vite + Tailwind CSS Frontend UI
│   │   ├── src/
│   │   │   ├── components/     # Evidence, Approval, Chat, RCA, Workflow UI
│   │   │   ├── hooks/          # useWebSocket, useIncidentState custom hooks
│   │   │   └── lib/            # API client and utility methods
│   └── worker/                 # Cloudflare Worker Backend Application
│       ├── src/
│       │   ├── agents/         # Durable Object Agent (IncidentAgent)
│       │   ├── workflows/      # Durable Workflow (IncidentInvestigationWorkflow)
│       │   ├── memory/         # Vectorize & KV Short/Long Term Memory
│       │   ├── routes/         # Hono REST API & Webhook endpoints
│       │   ├── services/       # Simulated Infrastructure, Telemetry & LLM
│       │   └── tools/          # Agent tool definitions (metrics, logs, remediation)
├── docs/                       # Architectural & Technical Documentation
│   ├── architecture.md         # System Architecture & Flow Diagrams
│   ├── cloudflare-services.md  # Detailed Cloudflare Service Rationale
│   ├── prompt-history.md       # LLM System Prompts, Tool Specs & Rationale
│   └── threat-model.md         # Security, Guardrails & Threat Analysis
├── tests/                      # Unit & Integration Test Suites
├── wrangler.jsonc              # Cloudflare Worker Configuration & Bindings
└── package.json                # Monorepo Workspace Configuration
```

---

## 🛠️ Getting Started

### Prerequisites

- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher
- **Wrangler**: Installed globally or via `npx wrangler`

### Setup Instructions

1. **Clone the repository and install dependencies**:
   ```bash
   git clone https://github.com/rajesh-kumar-jashti/incidentpilot-cloudflare.git
   cd incidentpilot-cloudflare
   npm run install:all
   ```

2. **Environment Configuration**:
   Copy `.env.example` to `.env` if needed for custom local bindings:
   ```bash
   cp .env.example .env
   ```

3. **Run Development Mode**:
   Starts both the Cloudflare Worker local runtime (via Wrangler) and the Vite development server concurrently:
   ```bash
   npm run dev
   ```
   - Frontend Console: `http://localhost:5173`
   - Worker API: `http://localhost:8787`

4. **Run Typecheck & Tests**:
   ```bash
   npm run typecheck
   npm run test
   ```

5. **Deploy to Cloudflare**:
   ```bash
   npm run deploy
   ```

---

## 📚 Deep-Dive Documentation

For detailed architectural decisions, prompt engineering, and security design, refer to the `docs/` folder:

- [📄 System Architecture](docs/architecture.md)
- [☁️ Cloudflare Services Rationale](docs/cloudflare-services.md)
- [🤖 Prompt History & LLM Engineering](docs/prompt-history.md)
- [🔒 Security & Threat Model](docs/threat-model.md)

---

## 📜 License

MIT License. Designed for Cloudflare AI Agent Challenge.