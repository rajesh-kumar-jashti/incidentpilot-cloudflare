// IncidentPilot — Shared UI Components

import React from "react";
import { clsx } from "clsx";
import type { IncidentSeverity, IncidentStatus, WorkflowStepStatus } from "../types/index.js";

// ─── Severity Badge ────────────────────────────────────────────────────────────

export function SeverityBadge({ severity }: { severity: IncidentSeverity }) {
  const classes = {
    CRITICAL: "badge-critical",
    HIGH: "badge-high",
    MEDIUM: "badge-medium",
    LOW: "badge-low",
  }[severity];

  return <span className={classes}>{severity}</span>;
}

// ─── Status Badge ──────────────────────────────────────────────────────────────

export function StatusBadge({ status }: { status: IncidentStatus }) {
  const config: Record<IncidentStatus, { label: string; class: string; dot: string }> = {
    OPEN: { label: "Open", class: "bg-text-muted/10 text-text-muted border border-text-muted/20", dot: "bg-text-muted" },
    INVESTIGATING: { label: "Investigating", class: "bg-status-investigating/10 text-status-investigating border border-status-investigating/20", dot: "bg-status-investigating animate-pulse-slow" },
    WAITING_FOR_APPROVAL: { label: "Awaiting Approval", class: "bg-status-waiting/10 text-status-waiting border border-status-waiting/20", dot: "bg-status-waiting animate-pulse-slow" },
    REMEDIATING: { label: "Remediating", class: "bg-status-remediating/10 text-status-remediating border border-status-remediating/20", dot: "bg-status-remediating animate-pulse-slow" },
    VERIFYING: { label: "Verifying", class: "bg-status-investigating/10 text-status-investigating border border-status-investigating/20", dot: "bg-status-investigating" },
    RESOLVED: { label: "Resolved", class: "bg-status-resolved/10 text-status-resolved border border-status-resolved/20", dot: "bg-status-resolved" },
    REJECTED: { label: "Rejected", class: "bg-status-rejected/10 text-status-rejected border border-status-rejected/20", dot: "bg-status-rejected" },
    APPROVAL_EXPIRED: { label: "Approval Expired", class: "bg-severity-critical/10 text-severity-critical border border-severity-critical/20", dot: "bg-severity-critical" },
    FAILED: { label: "Failed", class: "bg-severity-critical/10 text-severity-critical border border-severity-critical/20", dot: "bg-severity-critical" },
  };

  const c = config[status];
  return (
    <span className={clsx("badge", c.class)}>
      <span className={clsx("w-1.5 h-1.5 rounded-full inline-block", c.dot)} />
      {c.label}
    </span>
  );
}

// ─── Step Status Icon ──────────────────────────────────────────────────────────

export function StepStatusIcon({ status }: { status: WorkflowStepStatus }) {
  if (status === "completed") {
    return (
      <svg className="w-3.5 h-3.5 text-status-resolved" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  if (status === "running") {
    return (
      <div className="w-2 h-2 rounded-full bg-status-investigating animate-pulse-slow" />
    );
  }
  if (status === "failed") {
    return (
      <svg className="w-3.5 h-3.5 text-severity-critical" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    );
  }
  return <div className="w-1.5 h-1.5 rounded-full bg-border-strong" />;
}

// ─── Spinner ───────────────────────────────────────────────────────────────────

export function Spinner({ size = "sm", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  const sizes = { sm: "w-4 h-4", md: "w-6 h-6", lg: "w-8 h-8" };
  return (
    <div
      className={clsx(
        "border-2 border-border-strong border-t-brand rounded-full animate-spin",
        sizes[size],
        className
      )}
    />
  );
}

// ─── Connection Status ─────────────────────────────────────────────────────────

export function ConnectionIndicator({ status }: { status: "connected" | "connecting" | "disconnected" | "error" }) {
  const config = {
    connected: { dot: "bg-status-resolved", label: "Connected" },
    connecting: { dot: "bg-status-remediating animate-pulse-slow", label: "Connecting…" },
    disconnected: { dot: "bg-text-muted", label: "Disconnected" },
    error: { dot: "bg-severity-critical animate-pulse-slow", label: "Connection Error" },
  }[status];

  return (
    <span className="flex items-center gap-1.5 text-xs text-text-muted">
      <span className={clsx("w-1.5 h-1.5 rounded-full", config.dot)} />
      {config.label}
    </span>
  );
}

// ─── Metric Card ───────────────────────────────────────────────────────────────

export function MetricCard({
  label,
  baseline,
  current,
  unit,
  changePercent,
}: {
  label: string;
  baseline: number;
  current: number;
  unit: string;
  changePercent: number;
}) {
  const isWorstening = changePercent > 20;
  const changeClass = isWorstening ? "text-severity-critical" : "text-status-resolved";
  const prefix = changePercent > 0 ? "+" : "";

  return (
    <div className="bg-bg-secondary border border-border rounded p-3 space-y-1">
      <div className="text-xs text-text-muted font-medium uppercase tracking-wide">{label.replace(/_/g, " ")}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-mono font-semibold text-text-primary">
          {current}
          <span className="text-xs text-text-muted ml-1">{unit}</span>
        </span>
        {changePercent !== 0 && (
          <span className={clsx("text-xs font-mono", changeClass)}>
            {prefix}{Math.round(changePercent)}%
          </span>
        )}
      </div>
      <div className="text-xs text-text-muted font-mono">baseline: {baseline}{unit}</div>
    </div>
  );
}

// ─── Confidence Bar ────────────────────────────────────────────────────────────

export function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color = pct >= 80 ? "bg-status-resolved" : pct >= 60 ? "bg-status-remediating" : "bg-severity-critical";

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-text-muted">
        <span>AI-Estimated Confidence</span>
        <span className="font-mono font-medium text-text-primary">{pct}%</span>
      </div>
      <div className="h-1.5 bg-bg-secondary rounded-full overflow-hidden">
        <div
          className={clsx("h-full rounded-full transition-all", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-text-muted italic">
        Confidence is an AI-generated estimate, not a statistically validated probability.
      </p>
    </div>
  );
}

// ─── Empty State ───────────────────────────────────────────────────────────────

export function EmptyState({ icon, title, description }: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
      {icon && <div className="text-text-muted">{icon}</div>}
      <p className="text-sm font-medium text-text-secondary">{title}</p>
      {description && <p className="text-xs text-text-muted max-w-xs">{description}</p>}
    </div>
  );
}

// ─── Section ───────────────────────────────────────────────────────────────────

export function Section({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("space-y-3", className)}>
      {title && <h3 className="section-header">{title}</h3>}
      {children}
    </div>
  );
}

// ─── Log Level Badge ───────────────────────────────────────────────────────────

export function LogLevelBadge({ level }: { level: string }) {
  const classes: Record<string, string> = {
    DEBUG: "bg-text-muted/10 text-text-muted",
    INFO: "bg-status-investigating/10 text-status-investigating",
    WARN: "bg-severity-medium/10 text-severity-medium",
    ERROR: "bg-severity-critical/10 text-severity-critical",
    FATAL: "bg-severity-critical/20 text-severity-critical font-bold",
  };
  return (
    <span className={clsx("inline-block px-1.5 py-0.5 rounded text-xs font-mono font-medium", classes[level] ?? "bg-text-muted/10 text-text-muted")}>
      {level}
    </span>
  );
}
