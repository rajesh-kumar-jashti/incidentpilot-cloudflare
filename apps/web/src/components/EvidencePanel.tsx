// IncidentPilot — Evidence Panel

import React, { useState } from "react";
import { clsx } from "clsx";
import type { Evidence, MetricEvidence, LogEvidence, DeploymentEvidence, ServiceStatusEvidence, HistoricalIncidentEvidence } from "../types/index.js";
import { MetricCard, LogLevelBadge, Section } from "./ui.js";

interface EvidencePanelProps {
  evidence: Evidence[];
}

export function EvidencePanel({ evidence }: EvidencePanelProps) {
  const [activeTab, setActiveTab] = useState<"metrics" | "logs" | "deployment" | "historical">("metrics");

  const metrics = evidence.filter((e): e is MetricEvidence => e.type === "metric");
  const logs = evidence.filter((e): e is LogEvidence => e.type === "log");
  const deployments = evidence.filter((e): e is DeploymentEvidence => e.type === "deployment");
  const historical = evidence.filter((e): e is HistoricalIncidentEvidence => e.type === "historical_incident");

  const tabs = [
    { id: "metrics", label: "Metrics", count: metrics.length },
    { id: "logs", label: "Logs", count: logs.reduce((a, l) => a + l.entries.length, 0) },
    { id: "deployment", label: "Deployments", count: deployments.length },
    { id: "historical", label: "Historical", count: historical.length },
  ] as const;

  if (evidence.length === 0) {
    return (
      <div className="text-center py-8 text-text-muted text-sm">
        Evidence will appear as the investigation progresses…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              "px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors",
              activeTab === tab.id
                ? "border-brand text-text-primary"
                : "border-transparent text-text-muted hover:text-text-secondary"
            )}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className="ml-1.5 bg-bg-hover text-text-muted px-1.5 py-0.5 rounded-full text-xs">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === "metrics" && (
        <div className="grid grid-cols-2 gap-2">
          {metrics.length === 0 ? (
            <p className="text-xs text-text-muted col-span-2">No metrics collected yet.</p>
          ) : (
            metrics.map((m, i) => (
              <MetricCard
                key={i}
                label={m.metric}
                baseline={m.baseline}
                current={m.current}
                unit={m.unit}
                changePercent={m.changePercent}
              />
            ))
          )}
        </div>
      )}

      {activeTab === "logs" && (
        <div className="space-y-1">
          {logs.flatMap((l, i) =>
            l.entries
              .filter((e) => e.level === "ERROR" || e.level === "WARN")
              .slice(0, 10)
              .map((entry, j) => (
                <div
                  key={`${i}-${j}`}
                  className="flex items-start gap-2 p-2 rounded bg-bg-secondary border border-border text-xs font-mono group"
                >
                  <LogLevelBadge level={entry.level} />
                  <div className="flex-1 min-w-0">
                    <span className="text-text-muted mr-2">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="text-text-secondary break-all">{entry.message}</span>
                  </div>
                </div>
              ))
          )}
          {logs.flatMap((l) => l.entries).length === 0 && (
            <p className="text-xs text-text-muted">No logs collected yet.</p>
          )}
        </div>
      )}

      {activeTab === "deployment" && (
        <div className="space-y-3">
          {deployments.length === 0 ? (
            <p className="text-xs text-text-muted">No deployments found.</p>
          ) : (
            deployments.map((d, i) => (
              <DeploymentCard key={i} deployment={d} />
            ))
          )}
        </div>
      )}

      {activeTab === "historical" && (
        <div className="space-y-3">
          {historical.length === 0 ? (
            <p className="text-xs text-text-muted">No similar past incidents found.</p>
          ) : (
            historical.map((h, i) => (
              <HistoricalIncidentCard key={i} incident={h} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function DeploymentCard({ deployment }: { deployment: DeploymentEvidence }) {
  const deployedAt = new Date(deployment.deployedAt);
  const minutesAgo = deployment.durationMinutesBeforeIncident;

  return (
    <div className="card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-text-primary font-semibold">{deployment.version}</span>
          <span className="text-text-muted text-xs">← {deployment.previousVersion}</span>
        </div>
        {minutesAgo !== undefined && minutesAgo < 60 && (
          <span className="badge badge-high text-xs">{minutesAgo}m before incident</span>
        )}
      </div>
      <div className="text-xs text-text-muted">
        {deployedAt.toLocaleString()} · by {deployment.deployedBy}
      </div>
      {deployment.configChanges.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Config Changes</div>
          {deployment.configChanges.map((c, i) => (
            <div key={i} className="font-mono text-xs text-severity-high bg-severity-high/5 border border-severity-high/10 rounded px-2 py-1">
              {c}
            </div>
          ))}
        </div>
      )}
      {deployment.changes.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Changes</div>
          {deployment.changes.map((c, i) => (
            <div key={i} className="text-xs text-text-muted flex items-start gap-1.5">
              <span className="text-border-strong mt-0.5">·</span>
              <span>{c}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HistoricalIncidentCard({ incident }: { incident: HistoricalIncidentEvidence }) {
  return (
    <div className="card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm text-text-primary">{incident.incidentId}</span>
        {incident.similarity !== undefined && (
          <span className="text-xs text-text-muted font-mono">
            {Math.round(incident.similarity * 100)}% similar
          </span>
        )}
      </div>
      <p className="text-xs text-text-secondary">{incident.rootCause}</p>
      <div className="text-xs text-status-resolved">Resolution: {incident.resolution}</div>
      <div className="flex flex-wrap gap-1">
        {incident.symptoms.slice(0, 3).map((s, i) => (
          <span key={i} className="text-xs bg-bg-secondary border border-border rounded px-1.5 py-0.5 text-text-muted">
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}
