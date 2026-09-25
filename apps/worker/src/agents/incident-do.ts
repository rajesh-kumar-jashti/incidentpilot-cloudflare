// IncidentPilot — Incident Durable Object
// Strongly-consistent per-incident state using Durable Object SQLite
// Maintains: incident metadata, conversation, workflow state, approval status

import type {
  Env,
  Incident,
  ChatMessage,
  WorkflowStepState,
  WorkflowStep,
  RemediationProposal,
  RemediationResult,
  Evidence,
  RootCauseAnalysis,
  IncidentReport,
  WorkflowEvent,
} from "../types/index.js";
import { now, generateMessageId } from "../lib/utils.js";
import { logger } from "../lib/logger.js";

// ─── DO State Interface ───────────────────────────────────────────────────────

export interface IncidentDOState {
  incident: Incident | null;
  messages: ChatMessage[];
  workflowSteps: WorkflowStepState[];
  evidence: Evidence[];
  rca: RootCauseAnalysis | null;
  remediation: RemediationProposal | null;
  remediationResult: RemediationResult | null;
  report: IncidentReport | null;
  connectedSessions: Set<WebSocket>;
}

// ─── Durable Object ───────────────────────────────────────────────────────────

export class IncidentDurableObject implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private sessions: Set<WebSocket> = new Set();
  private sql: SqlStorage;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.sql = state.storage.sql;
    this.state.blockConcurrencyWhile(() => this.initialize());
  }

  private async initialize(): Promise<void> {
    // Create tables using DO SQLite
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY,
        service TEXT NOT NULL,
        environment TEXT NOT NULL,
        description TEXT NOT NULL,
        severity TEXT NOT NULL,
        status TEXT NOT NULL,
        workflow_id TEXT,
        agent_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resolved_at TEXT,
        duration_ms INTEGER
      )
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        incident_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_name TEXT,
        tool_call_id TEXT,
        tool_args TEXT,
        tool_result TEXT,
        timestamp TEXT NOT NULL
      )
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS workflow_steps (
        incident_id TEXT NOT NULL,
        step TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        duration_ms INTEGER,
        error TEXT,
        PRIMARY KEY (incident_id, step)
      )
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS evidence (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_id TEXT NOT NULL,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS rca (
        incident_id TEXT PRIMARY KEY,
        root_cause TEXT NOT NULL,
        confidence REAL NOT NULL,
        evidence TEXT NOT NULL,
        alternative_hypotheses TEXT NOT NULL,
        recommended_action TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS remediation (
        remediation_id TEXT PRIMARY KEY,
        incident_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        action TEXT NOT NULL,
        current_value TEXT,
        proposed_value TEXT,
        reason TEXT NOT NULL,
        estimated_impact TEXT NOT NULL,
        risk TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        approved_at TEXT,
        rejected_at TEXT,
        executed_at TEXT,
        expires_at TEXT NOT NULL,
        approved_by TEXT,
        result TEXT
      )
    `);
  }

  // ─── HTTP Handler ───────────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // WebSocket upgrade
      if (request.headers.get("Upgrade") === "websocket") {
        return this.handleWebSocket(request);
      }

      if (request.method === "GET" && path.endsWith("/state")) {
        return this.handleGetState();
      }

      if (request.method === "POST" && path.endsWith("/incident")) {
        return this.handleCreateIncident(request);
      }

      if (request.method === "PATCH" && path.endsWith("/incident")) {
        return this.handleUpdateIncident(request);
      }

      if (request.method === "POST" && path.endsWith("/message")) {
        return this.handleAddMessage(request);
      }

      if (request.method === "GET" && path.endsWith("/messages")) {
        return this.handleGetMessages();
      }

      if (request.method === "POST" && path.endsWith("/workflow-step")) {
        return this.handleWorkflowStep(request);
      }

      if (request.method === "POST" && path.endsWith("/evidence")) {
        return this.handleAddEvidence(request);
      }

      if (request.method === "POST" && path.endsWith("/rca")) {
        return this.handleSetRCA(request);
      }

      if (request.method === "POST" && path.endsWith("/remediation")) {
        return this.handleSetRemediation(request);
      }

      if (request.method === "POST" && path.endsWith("/approval")) {
        return this.handleApproval(request);
      }

      if (request.method === "POST" && path.endsWith("/remediation-result")) {
        return this.handleRemediationResult(request);
      }

      if (request.method === "POST" && path.endsWith("/report")) {
        return this.handleSetReport(request);
      }

      if (request.method === "POST" && path.endsWith("/broadcast")) {
        return this.handleBroadcast(request);
      }

      return new Response("Not Found", { status: 404 });
    } catch (err) {
      logger.error("do_error", {
        event: "do_error",
        metadata: { path, error: err instanceof Error ? err.message : String(err) },
      });
      return new Response(
        JSON.stringify({ success: false, error: "Internal error" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // ─── WebSocket ──────────────────────────────────────────────────────────────

  private handleWebSocket(request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    this.state.acceptWebSocket(server);
    this.sessions.add(server);

    server.addEventListener("close", () => {
      this.sessions.delete(server);
    });

    server.addEventListener("error", () => {
      this.sessions.delete(server);
    });

    // Send current state on connect
    this.state.waitUntil(
      this.sendCurrentState(server)
    );

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const data = JSON.parse(typeof message === "string" ? message : "{}");
      // Handle ping
      if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", timestamp: now() }));
      }
    } catch {
      // Ignore malformed messages
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.sessions.delete(ws);
  }

  private async sendCurrentState(ws: WebSocket): Promise<void> {
    try {
      const state = await this.getFullState();
      ws.send(JSON.stringify({ type: "state.sync", data: state, timestamp: now() }));
    } catch {
      // Non-fatal
    }
  }

  private broadcast(event: WorkflowEvent): void {
    const message = JSON.stringify(event);
    const deadSessions: WebSocket[] = [];

    for (const session of this.sessions) {
      try {
        session.send(message);
      } catch {
        deadSessions.push(session);
      }
    }

    deadSessions.forEach((s) => this.sessions.delete(s));
  }

  // ─── Route Handlers ─────────────────────────────────────────────────────────

  private async handleGetState(): Promise<Response> {
    const state = await this.getFullState();
    return json(state);
  }

  private async handleCreateIncident(request: Request): Promise<Response> {
    const body = await request.json() as Incident;
    this.sql.exec(
      `INSERT OR REPLACE INTO incidents 
       (id, service, environment, description, severity, status, workflow_id, agent_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      body.id,
      body.service,
      body.environment,
      body.description,
      body.severity,
      body.status,
      body.workflowId ?? null,
      body.agentId ?? null,
      body.createdAt,
      body.updatedAt
    );

    this.broadcast({
      type: "incident.updated",
      incidentId: body.id,
      data: body,
      timestamp: now(),
    });

    return json({ success: true, incidentId: body.id });
  }

  private async handleUpdateIncident(request: Request): Promise<Response> {
    const updates = await request.json() as Partial<Incident> & { id: string };

    this.sql.exec(
      `UPDATE incidents SET 
       status = COALESCE(?, status),
       workflow_id = COALESCE(?, workflow_id),
       updated_at = ?,
       resolved_at = COALESCE(?, resolved_at),
       duration_ms = COALESCE(?, duration_ms)
       WHERE id = ?`,
      updates.status ?? null,
      updates.workflowId ?? null,
      now(),
      updates.resolvedAt ?? null,
      updates.durationMs ?? null,
      updates.id
    );

    const incident = this.getIncidentById(updates.id);
    if (incident) {
      this.broadcast({
        type: "incident.updated",
        incidentId: updates.id,
        data: incident,
        timestamp: now(),
      });
    }

    return json({ success: true });
  }

  private async handleAddMessage(request: Request): Promise<Response> {
    const msg = await request.json() as ChatMessage;
    const id = msg.id ?? generateMessageId();

    this.sql.exec(
      `INSERT OR REPLACE INTO messages 
       (id, incident_id, role, content, tool_name, tool_call_id, tool_args, tool_result, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      msg.incidentId ?? "",
      msg.role,
      msg.content,
      msg.toolName ?? null,
      msg.toolCallId ?? null,
      msg.toolArgs ? JSON.stringify(msg.toolArgs) : null,
      msg.toolResult ? JSON.stringify(msg.toolResult) : null,
      msg.timestamp ?? now()
    );

    if (msg.role === "assistant" || msg.role === "user") {
      this.broadcast({
        type: "agent.message",
        incidentId: msg.incidentId ?? "",
        data: msg,
        timestamp: now(),
      });
    }

    return json({ success: true, id });
  }

  private async handleGetMessages(): Promise<Response> {
    const messages = this.getMessages();
    return json({ messages });
  }

  private async handleWorkflowStep(request: Request): Promise<Response> {
    const step = await request.json() as WorkflowStepState & { incidentId: string };

    this.sql.exec(
      `INSERT OR REPLACE INTO workflow_steps
       (incident_id, step, status, started_at, completed_at, duration_ms, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      step.incidentId,
      step.step,
      step.status,
      step.startedAt ?? null,
      step.completedAt ?? null,
      step.durationMs ?? null,
      step.error ?? null
    );

    const eventType =
      step.status === "running"
        ? "workflow.step.started"
        : step.status === "completed"
        ? "workflow.step.completed"
        : step.status === "failed"
        ? "workflow.step.failed"
        : "workflow.step.started";

    this.broadcast({
      type: eventType,
      incidentId: step.incidentId,
      step: step.step as WorkflowStep,
      durationMs: step.durationMs,
      timestamp: now(),
    });

    return json({ success: true });
  }

  private async handleAddEvidence(request: Request): Promise<Response> {
    const ev = await request.json() as { incidentId: string; evidence: Evidence };
    this.sql.exec(
      `INSERT INTO evidence (incident_id, type, data, created_at) VALUES (?, ?, ?, ?)`,
      ev.incidentId,
      ev.evidence.type,
      JSON.stringify(ev.evidence),
      now()
    );
    return json({ success: true });
  }

  private async handleSetRCA(request: Request): Promise<Response> {
    const body = await request.json() as { incidentId: string; rca: RootCauseAnalysis };
    this.sql.exec(
      `INSERT OR REPLACE INTO rca 
       (incident_id, root_cause, confidence, evidence, alternative_hypotheses, recommended_action, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      body.incidentId,
      body.rca.rootCause,
      body.rca.confidence,
      JSON.stringify(body.rca.evidence),
      JSON.stringify(body.rca.alternativeHypotheses),
      body.rca.recommendedAction,
      now()
    );

    this.broadcast({
      type: "incident.updated",
      incidentId: body.incidentId,
      data: { rca: body.rca },
      timestamp: now(),
    });

    return json({ success: true });
  }

  private async handleSetRemediation(request: Request): Promise<Response> {
    const body = await request.json() as { incidentId: string; remediation: RemediationProposal };
    const r = body.remediation;
    this.sql.exec(
      `INSERT OR REPLACE INTO remediation
       (remediation_id, incident_id, title, description, action, current_value, proposed_value, reason, estimated_impact, risk, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      r.remediationId,
      r.incidentId,
      r.title,
      r.description,
      r.action,
      r.currentValue ?? null,
      r.proposedValue ?? null,
      r.reason,
      r.estimatedImpact,
      r.risk,
      r.status,
      r.createdAt,
      r.expiresAt
    );

    this.broadcast({
      type: "workflow.approval.required",
      incidentId: body.incidentId,
      data: body.remediation,
      timestamp: now(),
    });

    return json({ success: true });
  }

  private async handleApproval(request: Request): Promise<Response> {
    const body = await request.json() as {
      incidentId: string;
      remediationId: string;
      approved: boolean;
      approvedBy?: string;
      reason?: string;
    };

    if (body.approved) {
      this.sql.exec(
        `UPDATE remediation SET status = 'APPROVED', approved_at = ?, approved_by = ? WHERE remediation_id = ?`,
        now(),
        body.approvedBy ?? "user",
        body.remediationId
      );
      this.sql.exec(
        `UPDATE incidents SET status = 'REMEDIATING', updated_at = ? WHERE id = ?`,
        now(),
        body.incidentId
      );
    } else {
      this.sql.exec(
        `UPDATE remediation SET status = 'REJECTED', rejected_at = ? WHERE remediation_id = ?`,
        now(),
        body.remediationId
      );
      this.sql.exec(
        `UPDATE incidents SET status = 'REJECTED', updated_at = ? WHERE id = ?`,
        now(),
        body.incidentId
      );
    }

    this.broadcast({
      type: "workflow.approval.received",
      incidentId: body.incidentId,
      data: { approved: body.approved, remediationId: body.remediationId },
      timestamp: now(),
    });

    return json({ success: true, approved: body.approved });
  }

  private async handleRemediationResult(request: Request): Promise<Response> {
    const body = await request.json() as { incidentId: string; remediationId: string; result: RemediationResult };
    this.sql.exec(
      `UPDATE remediation SET status = 'EXECUTED', executed_at = ?, result = ? WHERE remediation_id = ?`,
      now(),
      JSON.stringify(body.result),
      body.remediationId
    );
    return json({ success: true });
  }

  private async handleSetReport(request: Request): Promise<Response> {
    const body = await request.json() as { incidentId: string; reportKey: string };
    // Store report reference in incident
    this.sql.exec(
      `UPDATE incidents SET status = 'RESOLVED', resolved_at = ?, updated_at = ? WHERE id = ?`,
      now(),
      now(),
      body.incidentId
    );
    this.broadcast({
      type: "workflow.completed",
      incidentId: body.incidentId,
      data: { reportKey: body.reportKey },
      timestamp: now(),
    });
    return json({ success: true });
  }

  private async handleBroadcast(request: Request): Promise<Response> {
    const event = await request.json() as WorkflowEvent;
    this.broadcast(event);
    return json({ success: true });
  }

  // ─── State Accessors ────────────────────────────────────────────────────────

  private getIncidentById(id: string): Incident | null {
    const cursor = this.sql.exec(
      `SELECT * FROM incidents WHERE id = ?`,
      id
    );
    const row = cursor.toArray()[0];
    if (!row) return null;
    return {
      id: row["id"] as string,
      service: row["service"] as string,
      environment: row["environment"] as string,
      description: row["description"] as string,
      severity: row["severity"] as Incident["severity"],
      status: row["status"] as Incident["status"],
      workflowId: (row["workflow_id"] as string) ?? undefined,
      agentId: (row["agent_id"] as string) ?? undefined,
      createdAt: row["created_at"] as string,
      updatedAt: row["updated_at"] as string,
      resolvedAt: (row["resolved_at"] as string) ?? undefined,
      durationMs: (row["duration_ms"] as number) ?? undefined,
    };
  }

  private getMessages(): ChatMessage[] {
    const cursor = this.sql.exec(
      `SELECT * FROM messages ORDER BY timestamp ASC`
    );
    return cursor.toArray().map((row) => ({
      id: row["id"] as string,
      role: row["role"] as ChatMessage["role"],
      content: row["content"] as string,
      toolName: (row["tool_name"] as string) ?? undefined,
      toolCallId: (row["tool_call_id"] as string) ?? undefined,
      toolArgs: row["tool_args"] ? JSON.parse(row["tool_args"] as string) : undefined,
      toolResult: row["tool_result"] ? JSON.parse(row["tool_result"] as string) : undefined,
      timestamp: row["timestamp"] as string,
      incidentId: (row["incident_id"] as string) ?? undefined,
    }));
  }

  private getWorkflowSteps(incidentId: string): WorkflowStepState[] {
    const cursor = this.sql.exec(
      `SELECT * FROM workflow_steps WHERE incident_id = ? ORDER BY rowid ASC`,
      incidentId
    );
    return cursor.toArray().map((row) => ({
      step: row["step"] as WorkflowStep,
      status: row["status"] as WorkflowStepState["status"],
      startedAt: (row["started_at"] as string) ?? undefined,
      completedAt: (row["completed_at"] as string) ?? undefined,
      durationMs: (row["duration_ms"] as number) ?? undefined,
      error: (row["error"] as string) ?? undefined,
    }));
  }

  private getEvidence(incidentId: string): Evidence[] {
    const cursor = this.sql.exec(
      `SELECT * FROM evidence WHERE incident_id = ? ORDER BY id ASC`,
      incidentId
    );
    return cursor.toArray().map((row) => JSON.parse(row["data"] as string));
  }

  private getRCA(incidentId: string): RootCauseAnalysis | null {
    const cursor = this.sql.exec(
      `SELECT * FROM rca WHERE incident_id = ?`,
      incidentId
    );
    const row = cursor.toArray()[0];
    if (!row) return null;
    return {
      rootCause: row["root_cause"] as string,
      confidence: row["confidence"] as number,
      evidence: JSON.parse(row["evidence"] as string),
      alternativeHypotheses: JSON.parse(row["alternative_hypotheses"] as string),
      recommendedAction: row["recommended_action"] as string,
    };
  }

  private getRemediation(incidentId: string): RemediationProposal | null {
    const cursor = this.sql.exec(
      `SELECT * FROM remediation WHERE incident_id = ? ORDER BY rowid DESC LIMIT 1`,
      incidentId
    );
    const row = cursor.toArray()[0];
    if (!row) return null;
    return {
      remediationId: row["remediation_id"] as string,
      incidentId: row["incident_id"] as string,
      title: row["title"] as string,
      description: row["description"] as string,
      action: row["action"] as string,
      currentValue: (row["current_value"] as string) ?? undefined,
      proposedValue: (row["proposed_value"] as string) ?? undefined,
      reason: row["reason"] as string,
      estimatedImpact: row["estimated_impact"] as string,
      risk: row["risk"] as RemediationProposal["risk"],
      status: row["status"] as RemediationProposal["status"],
      createdAt: row["created_at"] as string,
      approvedAt: (row["approved_at"] as string) ?? undefined,
      rejectedAt: (row["rejected_at"] as string) ?? undefined,
      executedAt: (row["executed_at"] as string) ?? undefined,
      expiresAt: row["expires_at"] as string,
      approvedBy: (row["approved_by"] as string) ?? undefined,
    };
  }

  private async getFullState(): Promise<{
    incident: Incident | null;
    messages: ChatMessage[];
    workflowSteps: WorkflowStepState[];
    evidence: Evidence[];
    rca: RootCauseAnalysis | null;
    remediation: RemediationProposal | null;
  }> {
    // Get the most recent incident
    const cursor = this.sql.exec(
      `SELECT id FROM incidents ORDER BY created_at DESC LIMIT 1`
    );
    const row = cursor.toArray()[0];
    const incidentId = row ? (row["id"] as string) : null;

    return {
      incident: incidentId ? this.getIncidentById(incidentId) : null,
      messages: this.getMessages(),
      workflowSteps: incidentId ? this.getWorkflowSteps(incidentId) : [],
      evidence: incidentId ? this.getEvidence(incidentId) : [],
      rca: incidentId ? this.getRCA(incidentId) : null,
      remediation: incidentId ? this.getRemediation(incidentId) : null,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
