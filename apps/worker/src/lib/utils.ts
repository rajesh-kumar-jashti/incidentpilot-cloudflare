// IncidentPilot — ID Generation and Utilities

let incidentCounter = 1000;

export function generateIncidentId(): string {
  incidentCounter++;
  return `INC-${incidentCounter}`;
}

export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function generateWorkflowId(): string {
  return `wf_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function generateRemediationId(): string {
  return `rem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function now(): string {
  return new Date().toISOString();
}

export function durationMs(startMs: number): number {
  return Date.now() - startMs;
}

export function sanitizeForLogging(input: unknown): unknown {
  if (typeof input === "string") {
    // Remove potential prompt injection patterns
    return input.replace(
      /ignore\s+(all\s+)?(previous\s+)?instructions?/gi,
      "[REDACTED]"
    );
  }
  if (typeof input === "object" && input !== null) {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([k, v]) => [
        k,
        sanitizeForLogging(v),
      ])
    );
  }
  return input;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export function parseApprovalTimeout(envValue: string): number {
  const parsed = parseInt(envValue, 10);
  if (isNaN(parsed) || parsed <= 0) return 300;
  return parsed;
}

export function isValidService(service: string): boolean {
  const validServices = [
    "payments-api",
    "checkout-api",
    "auth-api",
    "notification-api",
  ];
  return validServices.includes(service);
}

export function isValidEnvironment(env: string): boolean {
  return ["production", "staging", "development"].includes(env);
}

export function truncateString(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}
