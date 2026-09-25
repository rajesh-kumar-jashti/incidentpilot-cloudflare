# IncidentPilot — Architecture

## 1. Architecture Diagram

```
Browser (React + Vite)
        │
        │  HTTPS / WebSocket
        ▼
Cloudflare Worker (incidentpilot-worker)
        │
        ├─── Routes (Hono-style)
        │         │
        │         ├─── POST /api/incidents → Create Incident → Workflow
        │         ├─── POST /api/incidents/:id/chat → IncidentAgent DO
        │         ├─── GET  /api/incidents/:id/ws → IncidentDO WebSocket
        │         ├─── POST /api/incidents/:id/approval → IncidentDO + Workflow event
        │         ├─── GET  /api/incidents/:id/report → R2
        │         └─── POST /api/demo/:scenario → Demo factory
        │
        ├─── IncidentAgent (Durable Object)
        │         ├─── SQLite: session + conversation state
        │         ├─── Workers AI: Llama 3.3 70B tool calling
        │         └─── Tool Registry (11 tools)
        │
        ├─── IncidentDurableObject
        │         ├─── SQLite: incidents, messages, steps, evidence, rca, remediation
        │         └─── WebSocket sessions (broadcast to connected browsers)
        │
        ├─── IncidentInvestigationWorkflow (Cloudflare Workflows)
        │         ├─── Step 1:  create-incident
        │         ├─── Step 2:  classify-incident (Workers AI)
        │         ├─── Step 3:  collect-service-status
        │         ├─── Step 4:  collect-metrics
        │         ├─── Step 5:  collect-logs
        │         ├─── Step 6:  inspect-deployments
        │         ├─── Step 7:  compare-versions
        │         ├─── Step 8:  retrieve-historical-incidents (Vectorize/local)
        │         ├─── Step 9:  correlate-evidence
        │         ├─── Step 10: root-cause-analysis (Workers AI)
        │         ├─── Step 11: generate-remediation
        │         ├─── Step 12: wait-for-human-approval (waitForEvent)
        │         ├─── Step 13: execute-remediation (ACTION — requires approval)
        │         ├─── Step 14: verify-recovery
        │         ├─── Step 15: generate-report → R2
        │         └─── Step 16: persist-incident-memory → Vectorize
        │
        ├─── Workers AI (@cf/meta/llama-3.3-70b-instruct-fp8-fast)
        ├─── R2 (incidentpilot-reports)
        └─── Vectorize (incidentpilot-incidents)
```

## 2. Request Lifecycle

**New Incident:**
1. Browser → `POST /api/incidents`
2. Worker validates input, generates `INC-XXXX`
3. Creates `IncidentInvestigationWorkflow` instance
4. Initializes `IncidentAgent` DO session
5. Browser opens WebSocket to `IncidentDO`
6. Workflow executes steps, broadcasting events to DO
7. DO pushes events to all connected WebSockets
8. Browser renders real-time progress

**Chat Message:**
1. Browser → `POST /api/incidents/:id/chat`
2. Worker routes to `IncidentAgent` DO
3. Agent retrieves conversation history (last 20 messages)
4. Calls Workers AI with system prompt + tools + history
5. Executes tool calls (get_metrics, search_logs, etc.)
6. Returns final response to browser
7. Agent stores message in SQLite

**Approval:**
1. Browser → `POST /api/incidents/:id/approval`
2. Worker validates (boolean approved, remediationId)
3. Updates `IncidentDO` state
4. Sends `waitForEvent` payload to `IncidentInvestigationWorkflow`
5. Workflow resumes (approved) or terminates (rejected/expired)
6. DO broadcasts `workflow.approval.received` to WebSocket clients

## 3. Agent Architecture

The `IncidentAgent` Durable Object implements a stateful agentic loop:

```
User message
     │
     ▼
Conversation history (SQLite, last 20 messages)
     │
     ▼
Workers AI (Llama 3.3 70B) + tool definitions
     │
     ├── tool_calls? ──► Execute tools → Append results → Continue loop (max 8 iter)
     │
     └── text response ──► Store in SQLite → Return to client
```

**Security:** Tool permission separation enforced at execution:
- READ tools: always executable
- ACTION tools: blocked without `approvalGranted` context flag

**Prompt injection defense:**
- All retrieved data labeled as "untrusted evidence" in system prompt
- Tool results include explicit warning labels
- `sanitizeForLogging` strips known injection patterns from logs

## 4. Workflow Architecture

Each workflow step is independently durable:

```typescript
await step.do("collect-metrics", {
  retries: { limit: 3, delay: "2 seconds", backoff: "exponential" }
}, async () => { ... })
```

- Transient failures retry without restarting the investigation
- `step.waitForEvent("approval")` implements human-in-the-loop
- Approval timeout configurable via `APPROVAL_TIMEOUT_SECONDS`
- Workflow emits progress to `IncidentDO` → WebSocket → Browser

## 5. Durable Object State Model

`IncidentDurableObject` uses SQLite tables:

| Table | Purpose |
|-------|---------|
| `incidents` | Core incident metadata |
| `messages` | Full conversation history |
| `workflow_steps` | Per-step status and timing |
| `evidence` | Collected evidence (metrics, logs, deployments) |
| `rca` | Root cause analysis result |
| `remediation` | Remediation proposal + approval status |

Each WebSocket connection is tracked in-memory. On connect, the DO sends full state sync. All state changes broadcast to all connected sessions.

`IncidentAgent` DO uses SQLite tables:

| Table | Purpose |
|-------|---------|
| `sessions` | Session → incident/scenario mapping |
| `conversation` | Per-session conversation messages (last 20 kept) |

## 6. Memory Architecture

Three memory layers:

**Short-term:** `IncidentAgent` SQLite conversation table. Maintains last 20 messages per session. Enables follow-up questions with full context.

**Incident memory:** Resolved incident stored as `IncidentMemory` struct with symptoms, root cause, evidence, remediation, and outcome.

**Long-term semantic (Vectorize):** `VectorizeMemoryRepository` generates embeddings via `@cf/baai/bge-base-en-v1.5` and stores them in Vectorize for semantic similarity search. Falls back to `LocalMemoryRepository` (keyword-based) when Vectorize is unavailable.

Clean abstraction via `IncidentMemoryRepository` interface enables swapping implementations.

## 7. R2 Usage

Incident reports stored as JSON artifacts:
- Key pattern: `incidents/{incidentId}/report.json`
- Custom metadata: incidentId, service, environment, generatedAt
- Download endpoint: `GET /api/incidents/:id/report`

R2 is used because:
- Durable Objects SQLite has size limits
- Reports need to survive DO eviction
- S3-compatible API makes reports easily portable

## 8. Vectorize Usage

`@cf/baai/bge-base-en-v1.5` embeddings (768-dim) stored per incident:
- ID: `incident-{incidentId}`
- Metadata: incidentId, service, rootCause, remediation, outcome
- Queried with `topK=3, returnMetadata=all`

When not available (local dev), `LocalMemoryRepository` provides keyword-based search with pre-seeded historical incidents.

## 9. Security Boundaries

```
Browser
  │
  ▼ (validates: service, environment, description length)
Worker input validation
  │
  ▼
Tool execution
  ├── READ tools: always allowed
  └── ACTION tools: blocked unless approvalGranted=true
            │
            └── approvalGranted set ONLY by workflow after waitForEvent returns true
                (never by the LLM itself)
```

**Key invariants:**
1. The LLM cannot set `approvalGranted=true` — this comes from the authenticated HTTP endpoint
2. `execute_remediation` checks `approvalGranted` at runtime, not just at routing
3. Idempotency: `execute-remediation` workflow step checks DO state before executing

## 10. Failure / Retry Model

| Failure | Behavior |
|---------|----------|
| LLM timeout | Agent returns error message; user can retry |
| Tool failure | `executeTool` catches and returns `{error}` without crashing loop |
| Workflow step failure | Retries with exponential backoff (3 attempts, 2s base) |
| Approval timeout | Workflow terminates cleanly, incident status → APPROVAL_EXPIRED |
| WebSocket disconnect | Client reconnects with exponential backoff (max 30s) |
| Browser refresh | DO state restored on WebSocket connect via `state.sync` event |
| R2 failure | Non-fatal; incident resolved without report artifact |
| Vectorize failure | Falls back to local keyword search |

## 11. Human Approval Flow

```
Workflow reaches step 12 (wait-for-human-approval)
     │
     ▼ step.waitForEvent("approval", { timeout: "300 seconds" })
     │
     │◄──── Browser sends POST /api/incidents/:id/approval
     │      Worker validates → updates DO → sends event to workflow instance
     │
     ├── approved=true ──► Workflow resumes → execute-remediation
     │
     ├── approved=false ──► Incident status = REJECTED
     │
     └── timeout ──► Incident status = APPROVAL_EXPIRED

NOTE: The LLM cannot trigger or approve remediation. Approval comes
only from the user's explicit HTTP action.
```

## Why Each Cloudflare Technology Was Chosen

See `docs/cloudflare-services.md` for the detailed rationale.
