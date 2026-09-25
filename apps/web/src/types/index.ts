// IncidentPilot — Frontend Types

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
  id: string;
  service: string;
  environment: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  workflowId?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  durationMs?: number;
}

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

export interface LogEntry {
  timestamp: string;
  level: "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";
  service: string;
  message: string;
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
  health: number;
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

export interface AlternativeHypothesis {
  hypothesis: string;
  whyLessSupported: string;
}

export interface RootCauseAnalysis {
  rootCause: string;
  confidence: number;
  evidence: string[];
  alternativeHypotheses: AlternativeHypothesis[];
  recommendedAction: string;
}

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
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolName?: string;
  timestamp: string;
  incidentId?: string;
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
  | "incident.updated"
  | "state.sync";

export interface WorkflowEvent {
  type: WorkflowEventType;
  incidentId: string;
  workflowId?: string;
  step?: WorkflowStep;
  durationMs?: number;
  data?: unknown;
  timestamp: string;
}

export interface IncidentState {
  incident: Incident | null;
  messages: ChatMessage[];
  workflowSteps: WorkflowStepState[];
  evidence: Evidence[];
  rca: RootCauseAnalysis | null;
  remediation: RemediationProposal | null;
}

export const ALL_WORKFLOW_STEPS: WorkflowStep[] = [
  "create-incident",
  "classify-incident",
  "collect-service-status",
  "collect-metrics",
  "collect-logs",
  "inspect-deployments",
  "compare-versions",
  "retrieve-historical-incidents",
  "correlate-evidence",
  "root-cause-analysis",
  "generate-remediation",
  "wait-for-human-approval",
  "execute-remediation",
  "verify-recovery",
  "generate-report",
  "persist-incident-memory",
];

export const STEP_LABELS: Record<WorkflowStep, string> = {
  "create-incident": "Create Incident",
  "classify-incident": "Classify Incident",
  "collect-service-status": "Service Status",
  "collect-metrics": "Collect Metrics",
  "collect-logs": "Search Logs",
  "inspect-deployments": "Inspect Deployments",
  "compare-versions": "Compare Versions",
  "retrieve-historical-incidents": "Historical Incidents",
  "correlate-evidence": "Correlate Evidence",
  "root-cause-analysis": "Root Cause Analysis",
  "generate-remediation": "Generate Remediation",
  "wait-for-human-approval": "Awaiting Approval",
  "execute-remediation": "Execute Remediation",
  "verify-recovery": "Verify Recovery",
  "generate-report": "Generate Report",
  "persist-incident-memory": "Persist Memory",
};
