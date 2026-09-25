// IncidentPilot — API Client
// All HTTP calls to the Worker API

const API_BASE = import.meta.env.VITE_API_URL ?? "";

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ─── Incidents ────────────────────────────────────────────────────────────────

export async function createIncident(params: {
  service: string;
  environment: string;
  description: string;
  severity?: string;
  scenario?: string;
}): Promise<{ success: boolean; data: { incidentId: string; workflowId?: string } }> {
  return request("/api/incidents", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function getIncidentState(incidentId: string): Promise<{
  success: boolean;
  data: {
    incident: unknown;
    messages: unknown[];
    workflowSteps: unknown[];
    evidence: unknown[];
    rca: unknown | null;
    remediation: unknown | null;
  };
}> {
  return request(`/api/incidents/${incidentId}/state`);
}

// ─── Demo ─────────────────────────────────────────────────────────────────────

export async function startDemoIncident(scenario: "1" | "2" | "3"): Promise<{
  success: boolean;
  data: { incidentId: string; workflowId?: string };
}> {
  return request(`/api/demo/${scenario}`, { method: "POST" });
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

export async function sendChatMessage(
  incidentId: string,
  message: string
): Promise<{
  success: boolean;
  message: { id: string; role: string; content: string; timestamp: string };
  rca?: unknown;
  toolCalls?: unknown[];
}> {
  return request(`/api/incidents/${incidentId}/chat`, {
    method: "POST",
    body: JSON.stringify({ message, sessionId: incidentId }),
  });
}

// ─── Approval ─────────────────────────────────────────────────────────────────

export async function submitApproval(
  incidentId: string,
  remediationId: string,
  approved: boolean,
  reason?: string
): Promise<{ success: boolean; approved: boolean }> {
  return request(`/api/incidents/${incidentId}/approval`, {
    method: "POST",
    body: JSON.stringify({ incidentId, remediationId, approved, reason }),
  });
}

// ─── Report ───────────────────────────────────────────────────────────────────

export function getReportUrl(incidentId: string): string {
  return `${API_BASE}/api/incidents/${incidentId}/report`;
}

// ─── WebSocket ────────────────────────────────────────────────────────────────

export function createWebSocket(incidentId: string): WebSocket {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = import.meta.env.VITE_WS_URL ?? window.location.host;
  const wsBase = `${protocol}//${host}`;
  return new WebSocket(`${wsBase}/api/incidents/${incidentId}/ws`);
}
