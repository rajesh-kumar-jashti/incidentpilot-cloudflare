// IncidentPilot — Incident State Hook
// Manages incident state with real-time WebSocket updates

import { useState, useCallback, useEffect } from "react";
import type {
  IncidentState,
  WorkflowEvent,
  WorkflowStepState,
  Evidence,
  ChatMessage,
  WorkflowStep,
  RemediationProposal,
  RootCauseAnalysis,
  Incident,
} from "../types/index.js";
import { useIncidentWebSocket } from "./useWebSocket.js";
import { getIncidentState } from "../lib/api.js";
import { ALL_WORKFLOW_STEPS } from "../types/index.js";

const EMPTY_STATE: IncidentState = {
  incident: null,
  messages: [],
  workflowSteps: [],
  evidence: [],
  rca: null,
  remediation: null,
};

export function useIncidentState(incidentId: string | null) {
  const [state, setState] = useState<IncidentState>(EMPTY_STATE);
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState<WorkflowStep | null>(null);

  // Fetch initial state
  const fetchState = useCallback(async () => {
    if (!incidentId) return;
    setLoading(true);
    try {
      const res = await getIncidentState(incidentId);
      if (res.success && res.data) {
        setState(res.data as IncidentState);
      }
    } catch {
      // State will be built from WebSocket events
    } finally {
      setLoading(false);
    }
  }, [incidentId]);

  useEffect(() => {
    if (incidentId) {
      setState(EMPTY_STATE);
      fetchState();
    }
  }, [incidentId, fetchState]);

  // Handle incoming WebSocket events
  const handleEvent = useCallback((event: WorkflowEvent) => {
    setState((prev) => {
      switch (event.type) {
        case "state.sync": {
          const synced = event.data as IncidentState | undefined;
          if (synced) return { ...prev, ...synced };
          return prev;
        }

        case "incident.updated": {
          const update = event.data as Partial<Incident & { rca?: RootCauseAnalysis }>;
          if (!update) return prev;
          if (update.rca) {
            return { ...prev, rca: update.rca };
          }
          return {
            ...prev,
            incident: prev.incident
              ? { ...prev.incident, ...update }
              : (update as Incident),
          };
        }

        case "workflow.step.started": {
          const step = event.step!;
          setCurrentStep(step);
          return {
            ...prev,
            workflowSteps: upsertStep(prev.workflowSteps, {
              step,
              status: "running",
              startedAt: event.timestamp,
            }),
          };
        }

        case "workflow.step.completed": {
          const step = event.step!;
          setCurrentStep(null);
          return {
            ...prev,
            workflowSteps: upsertStep(prev.workflowSteps, {
              step,
              status: "completed",
              completedAt: event.timestamp,
              durationMs: event.durationMs,
            }),
          };
        }

        case "workflow.step.failed": {
          const step = event.step!;
          setCurrentStep(null);
          return {
            ...prev,
            workflowSteps: upsertStep(prev.workflowSteps, {
              step,
              status: "failed",
              completedAt: event.timestamp,
              durationMs: event.durationMs,
            }),
          };
        }

        case "workflow.approval.required": {
          const remediation = event.data as RemediationProposal | undefined;
          return {
            ...prev,
            remediation: remediation ?? prev.remediation,
            incident: prev.incident
              ? { ...prev.incident, status: "WAITING_FOR_APPROVAL" }
              : prev.incident,
          };
        }

        case "workflow.approval.received": {
          const data = event.data as { approved: boolean } | undefined;
          return {
            ...prev,
            incident: prev.incident
              ? {
                  ...prev.incident,
                  status: data?.approved ? "REMEDIATING" : "REJECTED",
                }
              : prev.incident,
          };
        }

        case "workflow.completed": {
          return {
            ...prev,
            incident: prev.incident
              ? { ...prev.incident, status: "RESOLVED" }
              : prev.incident,
          };
        }

        case "workflow.failed": {
          return {
            ...prev,
            incident: prev.incident
              ? { ...prev.incident, status: "FAILED" }
              : prev.incident,
          };
        }

        case "agent.message": {
          const msg = event.data as ChatMessage | undefined;
          if (!msg) return prev;
          // Avoid duplicates
          if (prev.messages.some((m) => m.id === msg.id)) return prev;
          return { ...prev, messages: [...prev.messages, msg] };
        }

        default:
          return prev;
      }
    });
  }, []);

  const { status: wsStatus } = useIncidentWebSocket({
    incidentId,
    onEvent: handleEvent,
    enabled: !!incidentId,
  });

  // Add a local message (for immediate UI feedback)
  const addMessage = useCallback((msg: ChatMessage) => {
    setState((prev) => ({
      ...prev,
      messages: [...prev.messages.filter((m) => m.id !== msg.id), msg],
    }));
  }, []);

  // Get ordered workflow steps with pending steps filled in
  const orderedSteps: WorkflowStepState[] = ALL_WORKFLOW_STEPS.map((step) => {
    const found = state.workflowSteps.find((s) => s.step === step);
    return found ?? { step, status: "pending" };
  });

  return {
    state,
    loading,
    wsStatus,
    currentStep,
    orderedSteps,
    addMessage,
    refetch: fetchState,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function upsertStep(
  steps: WorkflowStepState[],
  update: Partial<WorkflowStepState> & { step: WorkflowStep }
): WorkflowStepState[] {
  const existing = steps.find((s) => s.step === update.step);
  if (existing) {
    return steps.map((s) =>
      s.step === update.step ? { ...s, ...update } : s
    );
  }
  return [...steps, { status: "pending", ...update } as WorkflowStepState];
}
