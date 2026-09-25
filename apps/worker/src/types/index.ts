// IncidentPilot — Core Types
// All shared types across the worker application

// ─── Cloudflare Env ───────────────────────────────────────────────────────────

export interface Env {
  // AI
  AI: Ai;

  // Durable Objects
  INCIDENT_AGENT: DurableObjectNamespace;
  INCIDENT_DO: DurableObjectNamespace;

  // Workflows
  INCIDENT_WORKFLOW: Workflow;

  // R2
  INCIDENT_REPORTS: R2Bucket;

  // Vectorize
  INCIDENT_VECTORS: VectorizeIndex;

  // Vars
  ENVIRONMENT: string;
  LOG_LEVEL: string;
  APPROVAL_TIMEOUT_SECONDS: string;
}

// ─── Incidents ────────────────────────────────────────────────────────────────

export type IncidentSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type IncidentStatus =
  | "OPEN"
  | "INVESTIGATING"
  | "WAITING_FOR_APPROVAL"
  | "REMEDIATING"
  | "VERIFYING"
  | "RESOLVED"
  | "REJECTED"
  | "APPROVAL_EXPIRED"
  | "FAILED";

export interface Incident {
  id: string; // e.g. INC-1024
  service: string;
  environment: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  workflowId?: string;
  agentId?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  durationMs?: number;
}

// ─── Evidence ─────────────────────────────────────────────────────────────────

export interface MetricEvidence {
  type: "metric";
  name: string;
  metric: string;
  baseline: number;
  current: number;
  unit: string;
  changePercent: number;
  timestamp: string;
}

export interface LogEvidence {
  type: "log";
  entries: LogEntry[];
  query: string;
  timestamp: string;
}

export interface DeploymentEvidence {
  type: "deployment";
  version: string;
  previousVersion: string;
  deployedAt: string;
  changes: string[];
  configChanges: string[];
  deployedBy: string;
  durationMinutesBeforeIncident?: number;
}

export interface ServiceStatusEvidence {
  type: "service_status";
  service: string;
  status: "healthy" | "degraded" | "down";
  health: number; // 0-100
  activeVersion: string;
  deploymentTimestamp: string;
}

export interface HistoricalIncidentEvidence {
  type: "historical_incident";
  incidentId: string;
  service: string;
  rootCause: string;
  resolution: string;
  symptoms: string[];
  occurredAt: string;
  similarity?: number;
}

export type Evidence =
  | MetricEvidence
  | LogEvidence
  | DeploymentEvidence
  | ServiceStatusEvidence
  | HistoricalIncidentEvidence;

// ─── Root Cause Analysis ──────────────────────────────────────────────────────

export interface AlternativeHypothesis {
  hypothesis: string;
  whyLessSupported: string;
}

export interface RootCauseAnalysis {
  rootCause: string;
  confidence: number; // 0-1, AI-estimated
  evidence: string[];
  alternativeHypotheses: AlternativeHypothesis[];
  recommendedAction: string;
}

// ─── Remediation ──────────────────────────────────────────────────────────────

export type RemediationStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "EXECUTED"
  | "FAILED"
  | "EXPIRED";

export interface RemediationProposal {
  remediationId: string;
  incidentId: string;
  title: string;
  description: string;
  action: string;
  currentValue?: string;
  proposedValue?: string;
  reason: string;
  estimatedImpact: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  status: RemediationStatus;
  createdAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  executedAt?: string;
  expiresAt: string;
  approvedBy?: string;
}

export interface RemediationResult {
  success: boolean;
  action: string;
  details: string;
  timestamp: string;
  simulated: true;
  beforeMetrics?: Record<string, number>;
  afterMetrics?: Record<string, number>;
}

// ─── Workflow ─────────────────────────────────────────────────────────────────

export type WorkflowStep =
  | "create-incident"
  | "classify-incident"
  | "collect-service-status"
  | "collect-metrics"
  | "collect-logs"
  | "inspect-deployments"
  | "compare-versions"
  | "retrieve-historical-incidents"
  | "correlate-evidence"
  | "root-cause-analysis"
  | "generate-remediation"
  | "wait-for-human-approval"
  | "execute-remediation"
  | "verify-recovery"
  | "generate-report"
  | "persist-incident-memory";

export type WorkflowStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface WorkflowStepState {
  step: WorkflowStep;
  status: WorkflowStepStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
}

export type WorkflowEventType =
  | "workflow.started"
  | "workflow.step.started"
  | "workflow.step.completed"
  | "workflow.step.failed"
  | "workflow.approval.required"
  | "workflow.approval.received"
  | "workflow.approval.expired"
  | "workflow.completed"
  | "workflow.failed"
  | "agent.message"
  | "incident.updated";

export interface WorkflowEvent {
  type: WorkflowEventType;
  incidentId: string;
  workflowId?: string;
  step?: WorkflowStep;
  durationMs?: number;
  data?: unknown;
  timestamp: string;
}

// ─── Workflow Input/Params ────────────────────────────────────────────────────

export interface WorkflowParams {
  incidentId: string;
  service: string;
  environment: string;
  description: string;
  severity: IncidentSeverity;
  agentId: string;
  scenario?: "db-connection-exhaustion" | "memory-leak" | "external-dependency";
}

// ─── Agent / Chat ─────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolName?: string;
  toolCallId?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  timestamp: string;
  incidentId?: string;
}

export interface AgentState {
  incidentId?: string;
  service?: string;
  environment?: string;
  conversationId: string;
  messages: ChatMessage[];
  currentWorkflowId?: string;
  currentStep?: WorkflowStep;
  awaitingApproval?: boolean;
  lastActivity: string;
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  result: unknown;
  error?: string;
}

// ─── Log Entries ──────────────────────────────────────────────────────────────

export interface LogEntry {
  timestamp: string;
  level: "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";
  service: string;
  environment: string;
  message: string;
  traceId?: string;
  requestId?: string;
  metadata?: Record<string, any>;
}

// ─── Simulated Infrastructure ─────────────────────────────────────────────────

export type ServiceName = "payments-api" | "checkout-api" | "auth-api" | "notification-api";
export type Environment = "production" | "staging";

export interface ServiceStatus {
  service: ServiceName;
  environment: Environment;
  status: "healthy" | "degraded" | "down";
  health: number;
  activeVersion: string;
  previousVersion: string;
  deploymentTimestamp: string;
  uptime: number;
  requestsPerSecond: number;
}

export interface MetricDataPoint {
  timestamp: string;
  value: number;
}

export interface MetricSeries {
  metric: string;
  service: string;
  environment: string;
  baseline: number;
  current: number;
  unit: string;
  changePercent: number;
  dataPoints: MetricDataPoint[];
}

export interface Deployment {
  service: ServiceName;
  environment: Environment;
  version: string;
  previousVersion: string;
  deployedAt: string;
  deployedBy: string;
  changes: string[];
  configChanges: string[];
  rollbackAvailable: boolean;
}

// ─── Incident Report ──────────────────────────────────────────────────────────

export interface IncidentReport {
  incidentId: string;
  generatedAt: string;
  executiveSummary: string;
  impact: string;
  timeline: Array<{ timestamp: string; event: string }>;
  observedEvidence: Evidence[];
  rootCause: RootCauseAnalysis;
  alternativeHypotheses: AlternativeHypothesis[];
  remediation: RemediationProposal;
  remediationResult?: RemediationResult;
  verification?: VerificationResult;
  lessonsLearned: string[];
  r2Key?: string;
}

export interface VerificationResult {
  success: boolean;
  metricsImproved: boolean;
  details: string;
  beforeMetrics: Record<string, number>;
  afterMetrics: Record<string, number>;
  timestamp: string;
}

// ─── Memory ───────────────────────────────────────────────────────────────────

export interface IncidentMemory {
  incidentId: string;
  service: string;
  environment: string;
  symptoms: string[];
  evidence: string[];
  rootCause: string;
  confidence: number;
  remediation: string;
  outcome: "resolved" | "rejected" | "failed";
  timestamps: {
    created: string;
    resolved?: string;
  };
  vectorId?: string;
  embeddingText?: string;
}

// ─── Structured Logging ───────────────────────────────────────────────────────

export interface StructuredLog {
  timestamp: string;
  requestId?: string;
  incidentId?: string;
  workflowId?: string;
  step?: string;
  event: string;
  durationMs?: number;
  status?: "success" | "error" | "warning";
  metadata?: Record<string, unknown>;
}

// ─── API Request/Response ─────────────────────────────────────────────────────

export interface CreateIncidentRequest {
  service: string;
  environment: string;
  description: string;
  severity?: IncidentSeverity;
  scenario?: WorkflowParams["scenario"];
}

export interface ApproveRemediationRequest {
  incidentId: string;
  remediationId: string;
  approved: boolean;
  reason?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  requestId: string;
}
