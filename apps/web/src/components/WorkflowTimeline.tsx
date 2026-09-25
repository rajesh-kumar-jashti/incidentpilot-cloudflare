// IncidentPilot — Workflow Timeline Component

import React from "react";
import { clsx } from "clsx";
import type { WorkflowStepState } from "../types/index.js";
import { STEP_LABELS } from "../types/index.js";
import { StepStatusIcon } from "./ui.js";

interface WorkflowTimelineProps {
  steps: WorkflowStepState[];
}

export function WorkflowTimeline({ steps }: WorkflowTimelineProps) {
  return (
    <div className="space-y-0.5">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        const label = STEP_LABELS[step.step] ?? step.step;

        return (
          <div key={step.step} className="flex items-start gap-3 group">
            {/* Timeline line */}
            <div className="flex flex-col items-center">
              <div
                className={clsx(
                  "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 border",
                  step.status === "completed" && "bg-status-resolved/10 border-status-resolved/30",
                  step.status === "running" && "bg-status-investigating/10 border-status-investigating/50",
                  step.status === "failed" && "bg-severity-critical/10 border-severity-critical/30",
                  step.status === "pending" && "bg-bg-secondary border-border",
                  step.status === "skipped" && "bg-bg-secondary border-border opacity-50"
                )}
              >
                <StepStatusIcon status={step.status} />
              </div>
              {!isLast && (
                <div
                  className={clsx(
                    "w-px flex-1 mt-0.5 mb-0.5",
                    step.status === "completed"
                      ? "bg-status-resolved/20"
                      : "bg-border"
                  )}
                  style={{ minHeight: "12px" }}
                />
              )}
            </div>

            {/* Step content */}
            <div className="flex-1 pb-2 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={clsx(
                    "text-sm leading-6",
                    step.status === "completed" && "text-text-secondary",
                    step.status === "running" && "text-text-primary font-medium",
                    step.status === "failed" && "text-severity-critical",
                    step.status === "pending" && "text-text-muted",
                    step.status === "skipped" && "text-text-muted opacity-50 line-through"
                  )}
                >
                  {step.status === "running" && (
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-status-investigating animate-pulse-slow mr-1.5 mb-0.5" />
                  )}
                  {label}
                </span>
                {step.durationMs && step.status === "completed" && (
                  <span className="text-xs text-text-muted font-mono flex-shrink-0">
                    {step.durationMs < 1000
                      ? `${step.durationMs}ms`
                      : `${(step.durationMs / 1000).toFixed(1)}s`}
                  </span>
                )}
              </div>
              {step.error && (
                <p className="text-xs text-severity-critical mt-0.5 font-mono">{step.error}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
