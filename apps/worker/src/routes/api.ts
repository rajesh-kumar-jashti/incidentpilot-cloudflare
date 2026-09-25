// IncidentPilot — API Routes
// Clean route handlers with validation and security

import type {
  Env,
  CreateIncidentRequest,
  ApproveRemediationRequest,
  ApiResponse,
} from "../types/index.js";
import {
  generateIncidentId,
  generateRequestId,
  generateWorkflowId,
  now,
  isValidService,
  isValidEnvironment,
} from "../lib/utils.js";
import { createRequestLogger } from "../lib/logger.js";

// ─── Health ───────────────────────────────────────────────────────────────────

export async function handleHealth(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const requestId = generateRequestId();
  const log = createRequestLogger(requestId);
  log.info("health_check");

  return json({
    success: true,
    service: "IncidentPilot Worker",
    version: "1.0.0",
    timestamp: now(),
    environment: env.ENVIRONMENT,
    requestId,
    capabilities: {
      ai: true,
      workflows: true,
      durableObjects: true,
      r2: true,
      vectorize: !!env.INCIDENT_VECTORS,
    },
  });
}

// ─── Incident Routes ──────────────────────────────────────────────────────────

export async function handleCreateIncident(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const requestId = generateRequestId();
  const log = createRequestLogger(requestId);

  // Rate limiting hint (in production, use CF rate limiting rules)
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  log.info("create_incident_request", { metadata: { ip } });

  // Parse and validate
  let body: CreateIncidentRequest;
  try {
    body = await request.json() as CreateIncidentRequest;
  } catch {
    return jsonError("Invalid JSON body", 400, requestId);
  }

  // Input validation
  if (!body.service || !isValidService(body.service)) {
    return jsonError(
      "Invalid service. Must be one of: payments-api, checkout-api, auth-api, notification-api",
      400,
      requestId
    );
  }
  if (!body.environment || !isValidEnvironment(body.environment)) {
    return jsonError("Invalid environment. Must be: production, staging, or development", 400, requestId);
  }
  if (!body.description || body.description.trim().length < 5) {
    return jsonError("Description is required (minimum 5 characters)", 400, requestId);
  }
  if (body.description.length > 500) {
    return jsonError("Description too long (maximum 500 characters)", 400, requestId);
  }

  // Generate IDs
  const incidentId = generateIncidentId();
  const agentId = `agent-${incidentId}`;

  log.info("incident_creating", { incidentId, metadata: { service: body.service, environment: body.environment } });

  // Start the workflow
  let workflowId: string | undefined;
  try {
    const workflowInstance = await env.INCIDENT_WORKFLOW.create({
      id: generateWorkflowId(),
      params: {
        incidentId,
        service: body.service,
        environment: body.environment,
        description: body.description,
        severity: body.severity ?? "HIGH",
        agentId,
        scenario: body.scenario,
      },
    });
    workflowId = workflowInstance.id;
    log.info("workflow_started", { incidentId, metadata: { workflowId } });
  } catch (err) {
    log.error("workflow_start_error", {
      incidentId,
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    // Don't fail — incident can exist without workflow in degraded mode
  }

  // Initialize the Agent session
  try {
    const agentDoId = env.INCIDENT_AGENT.idFromName(agentId);
    const agentStub = env.INCIDENT_AGENT.get(agentDoId);
    await agentStub.fetch(
      new Request("https://agent/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: incidentId,
          incidentId,
          service: body.service,
          environment: body.environment,
          scenario: body.scenario,
        }),
      })
    );
  } catch (err) {
    log.warn("agent_init_error", {
      incidentId,
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  }

  const response: ApiResponse<{ incidentId: string; workflowId?: string }> = {
    success: true,
    data: { incidentId, workflowId },
    requestId,
  };

  return json(response, 201);
}

// ─── Agent Chat ───────────────────────────────────────────────────────────────

export async function handleAgentChat(
  request: Request,
  env: Env,
  incidentId: string
): Promise<Response> {
  const requestId = generateRequestId();
  const log = createRequestLogger(requestId, incidentId);

  let body: { message: string; sessionId?: string };
  try {
    body = await request.json() as { message: string; sessionId?: string };
  } catch {
    return jsonError("Invalid JSON body", 400, requestId);
  }

  if (!body.message?.trim()) {
    return jsonError("Message is required", 400, requestId);
  }
  if (body.message.length > 4000) {
    return jsonError("Message too long (max 4000 characters)", 400, requestId);
  }

  log.info("agent_chat_request", { metadata: { messageLen: body.message.length } });

  const agentId = `agent-${incidentId}`;
  const agentDoId = env.INCIDENT_AGENT.idFromName(agentId);
  const agentStub = env.INCIDENT_AGENT.get(agentDoId);

  try {
    const res = await agentStub.fetch(
      new Request("https://agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: body.sessionId ?? incidentId,
          message: body.message,
          incidentId,
        }),
      })
    );

    const data = await res.json();
    return json(data);
  } catch (err) {
    log.error("agent_chat_error", {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    return jsonError("Agent error: " + (err instanceof Error ? err.message : "Unknown"), 500, requestId);
  }
}

// ─── Incident State ────────────────────────────────────────────────────────────

export async function handleGetIncidentState(
  request: Request,
  env: Env,
  incidentId: string
): Promise<Response> {
  const requestId = generateRequestId();

  const doId = env.INCIDENT_DO.idFromName(incidentId);
  const doStub = env.INCIDENT_DO.get(doId);

  try {
    const res = await doStub.fetch(
      new Request("https://do/state", { method: "GET" })
    );
    const state = await res.json();
    return json({ success: true, data: state, requestId });
  } catch (err) {
    return jsonError("Failed to get incident state", 500, requestId);
  }
}

// ─── WebSocket (Real-time) ────────────────────────────────────────────────────

export async function handleWebSocket(
  request: Request,
  env: Env,
  incidentId: string
): Promise<Response> {
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }

  const doId = env.INCIDENT_DO.idFromName(incidentId);
  const doStub = env.INCIDENT_DO.get(doId);

  // Forward WebSocket upgrade to the Durable Object
  return doStub.fetch(request);
}

// ─── Approval ─────────────────────────────────────────────────────────────────

export async function handleApproval(
  request: Request,
  env: Env,
  incidentId: string
): Promise<Response> {
  const requestId = generateRequestId();
  const log = createRequestLogger(requestId, incidentId);

  let body: ApproveRemediationRequest;
  try {
    body = await request.json() as ApproveRemediationRequest;
  } catch {
    return jsonError("Invalid JSON body", 400, requestId);
  }

  if (!body.remediationId) {
    return jsonError("remediationId is required", 400, requestId);
  }
  if (typeof body.approved !== "boolean") {
    return jsonError("approved (boolean) is required", 400, requestId);
  }

  log.info("approval_request", {
    metadata: { remediationId: body.remediationId, approved: body.approved },
  });

  // Update DO state
  const doId = env.INCIDENT_DO.idFromName(incidentId);
  const doStub = env.INCIDENT_DO.get(doId);

  await doStub.fetch(
    new Request("https://do/approval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incidentId,
        remediationId: body.remediationId,
        approved: body.approved,
        approvedBy: "user", // In production: extract from auth token
        reason: body.reason,
      }),
    })
  );

  // Send approval event to workflow via waitForEvent
  try {
    // Find the workflow instance for this incident
    const instanceId = `${incidentId}-workflow`;
    const handle = await env.INCIDENT_WORKFLOW.get(instanceId);
    await handle.sendEvent({
      type: "approval",
      payload: { approved: body.approved, approvedBy: "user" },
    });
  } catch (err) {
    log.warn("workflow_event_error", {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    // Not fatal if workflow lookup fails — DO state is the source of truth
  }

  return json({ success: true, approved: body.approved, requestId });
}

// ─── Report Download ──────────────────────────────────────────────────────────

export async function handleGetReport(
  request: Request,
  env: Env,
  incidentId: string
): Promise<Response> {
  const requestId = generateRequestId();

  const key = `incidents/${incidentId}/report.json`;
  const object = await env.INCIDENT_REPORTS.get(key);

  if (!object) {
    return jsonError("Report not found", 404, requestId);
  }

  const body = await object.text();
  return new Response(body, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${incidentId}-report.json"`,
    },
  });
}

// ─── Demo Incidents ────────────────────────────────────────────────────────────

export async function handleDemoIncident(
  request: Request,
  env: Env,
  scenario: string
): Promise<Response> {
  const requestId = generateRequestId();

  const demoScenarios: Record<string, CreateIncidentRequest & { scenario: string }> = {
    "1": {
      service: "payments-api",
      environment: "production",
      description: "Investigate the increased latency in payments-api. p95 latency has spiked above 2.8 seconds and error rate is elevated at 8.2%.",
      severity: "HIGH",
      scenario: "db-connection-exhaustion",
    },
    "2": {
      service: "checkout-api",
      environment: "production",
      description: "Checkout-api memory usage is steadily increasing and causing periodic restarts. Users experiencing slow checkout.",
      severity: "HIGH",
      scenario: "memory-leak",
    },
    "3": {
      service: "auth-api",
      environment: "production",
      description: "Authentication latency has increased significantly. Users unable to log in. No recent auth-api deployments.",
      severity: "CRITICAL",
      scenario: "external-dependency",
    },
  };

  const demo = demoScenarios[scenario];
  if (!demo) {
    return jsonError("Invalid scenario. Use 1, 2, or 3.", 400, requestId);
  }

  // Create the incident via the same handler
  const mockRequest = new Request("https://api/incidents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(demo),
  });

  return handleCreateIncident(mockRequest, env, {} as ExecutionContext);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function jsonError(message: string, status: number, requestId: string): Response {
  return json({ success: false, error: message, requestId }, status);
}
