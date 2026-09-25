// IncidentPilot — Main Application

import React, { useState, useCallback } from "react";
import { clsx } from "clsx";
import type { Incident, IncidentSeverity } from "./types/index.js";
import { createIncident, startDemoIncident, getReportUrl } from "./lib/api.js";
import { useIncidentState } from "./hooks/useIncidentState.js";
import { ConnectionIndicator, SeverityBadge, StatusBadge, Spinner } from "./components/ui.js";
import { WorkflowTimeline } from "./components/WorkflowTimeline.js";
import { EvidencePanel } from "./components/EvidencePanel.js";
import { ApprovalPanel } from "./components/ApprovalPanel.js";
import { ChatPanel } from "./components/ChatPanel.js";
import { RCAPanel } from "./components/RCAPanel.js";

// ─── Sidebar incident list (mock local state) ─────────────────────────────────

interface SidebarIncident {
  id: string;
  service: string;
  status: Incident["status"];
  severity: IncidentSeverity;
  createdAt: string;
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [activeIncidentId, setActiveIncidentId] = useState<string | null>(null);
  const [sidebarIncidents, setSidebarIncidents] = useState<SidebarIncident[]>([]);
  const [showNewIncident, setShowNewIncident] = useState(false);
  const [creatingDemo, setCreatingDemo] = useState<string | null>(null);

  const { state, wsStatus, orderedSteps, addMessage, refetch } = useIncidentState(activeIncidentId);

  const handleIncidentCreated = useCallback(
    (incidentId: string, service: string, severity: IncidentSeverity) => {
      const si: SidebarIncident = {
        id: incidentId,
        service,
        status: "INVESTIGATING",
        severity,
        createdAt: new Date().toISOString(),
      };
      setSidebarIncidents((prev) => [si, ...prev]);
      setActiveIncidentId(incidentId);
      setShowNewIncident(false);
    },
    []
  );

  // Update sidebar when incident state changes
  React.useEffect(() => {
    if (!state.incident) return;
    setSidebarIncidents((prev) =>
      prev.map((si) =>
        si.id === state.incident!.id
          ? { ...si, status: state.incident!.status }
          : si
      )
    );
  }, [state.incident?.status]);

  const handleDemoIncident = async (scenario: "1" | "2" | "3") => {
    setCreatingDemo(scenario);
    try {
      const res = await startDemoIncident(scenario);
      if (res.success && res.data?.incidentId) {
        const services = { "1": "payments-api", "2": "checkout-api", "3": "auth-api" };
        handleIncidentCreated(res.data.incidentId, services[scenario], "HIGH");
      }
    } catch (err) {
      console.error("Demo incident failed:", err);
    } finally {
      setCreatingDemo(null);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-bg overflow-hidden">
      {/* Top bar */}
      <header className="h-11 flex items-center justify-between px-4 border-b border-border bg-bg-secondary flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-brand rounded flex items-center justify-center">
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-text-primary">IncidentPilot</span>
          </div>
          <div className="w-px h-4 bg-border" />
          <span className="text-xs text-text-muted">AI Incident Response Agent</span>
        </div>
        <ConnectionIndicator status={wsStatus} />
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-56 border-r border-border bg-bg-secondary flex flex-col flex-shrink-0">
          {/* New Incident */}
          <div className="p-3 border-b border-border">
            <button
              onClick={() => setShowNewIncident(true)}
              className="btn-primary w-full justify-center text-xs"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New Incident
            </button>
          </div>

          {/* Demo Incidents */}
          <div className="p-3 border-b border-border">
            <div className="section-header mb-2">Demo Scenarios</div>
            <div className="space-y-1">
              {[
                { id: "1", label: "DB Connection Exhaustion", service: "payments-api" },
                { id: "2", label: "Memory Leak", service: "checkout-api" },
                { id: "3", label: "External Dependency", service: "auth-api" },
              ].map((demo) => (
                <button
                  key={demo.id}
                  onClick={() => handleDemoIncident(demo.id as "1" | "2" | "3")}
                  disabled={!!creatingDemo}
                  className="w-full text-left px-2 py-1.5 rounded text-xs text-text-muted hover:bg-bg-hover hover:text-text-secondary transition-colors border border-transparent hover:border-border disabled:opacity-50"
                >
                  {creatingDemo === demo.id ? (
                    <span className="flex items-center gap-1"><Spinner size="sm" /> Starting…</span>
                  ) : (
                    <>
                      <div className="font-medium text-text-secondary">{demo.service}</div>
                      <div className="text-text-muted">{demo.label}</div>
                    </>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Incident List */}
          <div className="flex-1 overflow-y-auto p-3">
            <div className="section-header">Incidents</div>
            {sidebarIncidents.length === 0 ? (
              <p className="text-xs text-text-muted">No incidents yet. Start a demo or create a new one.</p>
            ) : (
              <div className="space-y-1">
                {sidebarIncidents.map((si) => (
                  <button
                    key={si.id}
                    onClick={() => setActiveIncidentId(si.id)}
                    className={clsx(
                      "w-full text-left px-2 py-2 rounded text-xs transition-colors border",
                      activeIncidentId === si.id
                        ? "bg-bg-hover border-border-strong text-text-primary"
                        : "border-transparent text-text-muted hover:bg-bg-hover hover:text-text-secondary"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-medium">{si.id}</span>
                      <SeverityBadge severity={si.severity} />
                    </div>
                    <div className="text-text-muted mt-0.5">{si.service}</div>
                    <div className="mt-1">
                      <StatusBadge status={si.status} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-hidden">
          {!activeIncidentId || !state.incident ? (
            <WelcomeScreen onDemo={handleDemoIncident} creatingDemo={creatingDemo} />
          ) : (
            <IncidentView
              incident={state.incident}
              steps={orderedSteps}
              evidence={state.evidence}
              rca={state.rca}
              remediation={state.remediation}
              messages={state.messages}
              onApprovalDecision={refetch}
              onMessage={addMessage}
            />
          )}
        </main>
      </div>

      {/* New Incident Modal */}
      {showNewIncident && (
        <NewIncidentModal
          onClose={() => setShowNewIncident(false)}
          onCreated={handleIncidentCreated}
        />
      )}
    </div>
  );
}

// ─── Welcome Screen ────────────────────────────────────────────────────────────

function WelcomeScreen({
  onDemo,
  creatingDemo,
}: {
  onDemo: (s: "1" | "2" | "3") => void;
  creatingDemo: string | null;
}) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center space-y-6 max-w-md px-8">
        <div className="flex justify-center">
          <div className="w-16 h-16 bg-brand/10 border border-brand/20 rounded-2xl flex items-center justify-center">
            <svg className="w-8 h-8 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">IncidentPilot</h1>
          <p className="text-sm text-text-muted mt-2 leading-relaxed">
            Investigate production incidents with an AI agent that remembers, reasons, and acts.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2">
          <p className="text-xs text-text-muted uppercase tracking-widest font-semibold">Try a demo scenario</p>
          {[
            { id: "1" as const, title: "DB Connection Exhaustion", service: "payments-api", description: "Latency spike caused by reduced connection pool after deployment" },
            { id: "2" as const, title: "Memory Leak", service: "checkout-api", description: "Unbounded in-memory cache introduced in latest release" },
            { id: "3" as const, title: "External Dependency Failure", service: "auth-api", description: "Authentication latency from downstream identity provider outage" },
          ].map((demo) => (
            <button
              key={demo.id}
              onClick={() => onDemo(demo.id)}
              disabled={!!creatingDemo}
              className="text-left card-hover p-4 rounded-lg transition-colors disabled:opacity-50"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-text-primary">{demo.title}</span>
                <span className="text-xs font-mono text-brand">{demo.service}</span>
              </div>
              <p className="text-xs text-text-muted">{demo.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Incident View ─────────────────────────────────────────────────────────────

function IncidentView({
  incident,
  steps,
  evidence,
  rca,
  remediation,
  messages,
  onApprovalDecision,
  onMessage,
}: {
  incident: Incident;
  steps: ReturnType<typeof useIncidentState>["orderedSteps"];
  evidence: ReturnType<typeof useIncidentState>["state"]["evidence"];
  rca: ReturnType<typeof useIncidentState>["state"]["rca"];
  remediation: ReturnType<typeof useIncidentState>["state"]["remediation"];
  messages: ReturnType<typeof useIncidentState>["state"]["messages"];
  onApprovalDecision: () => void;
  onMessage: (m: ReturnType<typeof useIncidentState>["state"]["messages"][0]) => void;
}) {
  const [activePanel, setActivePanel] = useState<"investigation" | "evidence" | "rca" | "chat">("investigation");

  const durationMs = incident.createdAt
    ? Date.now() - new Date(incident.createdAt).getTime()
    : 0;

  const showApproval =
    incident.status === "WAITING_FOR_APPROVAL" &&
    remediation &&
    remediation.status === "PENDING";

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Incident header */}
      <div className="px-5 py-3 border-b border-border bg-bg-secondary flex-shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-text-muted">{incident.id}</span>
              <SeverityBadge severity={incident.severity} />
              <StatusBadge status={incident.status} />
            </div>
            <h2 className="text-sm font-semibold text-text-primary mt-1 max-w-xl truncate">
              {incident.description}
            </h2>
            <div className="flex items-center gap-4 mt-1 text-xs text-text-muted">
              <span>
                <span className="font-medium text-text-secondary">{incident.service}</span> · {incident.environment}
              </span>
              <span>Started {new Date(incident.createdAt).toLocaleTimeString()}</span>
              <span className="font-mono">{formatDuration(durationMs)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {incident.status === "RESOLVED" && (
              <a
                href={getReportUrl(incident.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary text-xs"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Download Report
              </a>
            )}
          </div>
        </div>

        {/* Panel tabs */}
        <div className="flex gap-1 mt-3 -mb-3">
          {(["investigation", "evidence", "rca", "chat"] as const).map((panel) => (
            <button
              key={panel}
              onClick={() => setActivePanel(panel)}
              className={clsx(
                "px-3 py-1.5 text-xs font-medium rounded-t border-b-2 transition-colors",
                activePanel === panel
                  ? "border-brand text-text-primary"
                  : "border-transparent text-text-muted hover:text-text-secondary"
              )}
            >
              {panel === "investigation" && "Timeline"}
              {panel === "evidence" && `Evidence ${evidence.length > 0 ? `(${evidence.length})` : ""}`}
              {panel === "rca" && "Root Cause"}
              {panel === "chat" && `Chat ${messages.filter(m => m.role !== "system").length > 0 ? `(${messages.filter(m => m.role !== "system").length})` : ""}`}
            </button>
          ))}
        </div>
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* Approval panel always visible when waiting */}
        {showApproval && (
          <ApprovalPanel
            incidentId={incident.id}
            remediation={remediation!}
            onDecision={onApprovalDecision}
          />
        )}

        {activePanel === "investigation" && (
          <div className="max-w-sm">
            <WorkflowTimeline steps={steps} />
          </div>
        )}

        {activePanel === "evidence" && (
          <EvidencePanel evidence={evidence} />
        )}

        {activePanel === "rca" && (
          rca ? (
            <RCAPanel rca={rca} />
          ) : (
            <div className="text-sm text-text-muted text-center py-8">
              Root cause analysis will appear here once the investigation reaches that step.
            </div>
          )
        )}

        {activePanel === "chat" && (
          <div className="h-full min-h-[400px]">
            <ChatPanel
              incidentId={incident.id}
              messages={messages}
              onMessage={onMessage}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── New Incident Modal ────────────────────────────────────────────────────────

function NewIncidentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string, service: string, severity: IncidentSeverity) => void;
}) {
  const [form, setForm] = useState({
    service: "payments-api",
    environment: "production",
    description: "",
    severity: "HIGH" as IncidentSeverity,
  });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await createIncident(form);
      if (res.success && res.data?.incidentId) {
        onCreated(res.data.incidentId, form.service, form.severity);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create incident");
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-card border border-border rounded-xl w-full max-w-md shadow-2xl animate-slide-up">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">New Incident</h2>
          <button onClick={onClose} className="btn-ghost p-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-text-muted font-medium">Service</label>
              <select
                className="input"
                value={form.service}
                onChange={(e) => setForm((f) => ({ ...f, service: e.target.value }))}
              >
                <option value="payments-api">payments-api</option>
                <option value="checkout-api">checkout-api</option>
                <option value="auth-api">auth-api</option>
                <option value="notification-api">notification-api</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-text-muted font-medium">Environment</label>
              <select
                className="input"
                value={form.environment}
                onChange={(e) => setForm((f) => ({ ...f, environment: e.target.value }))}
              >
                <option value="production">production</option>
                <option value="staging">staging</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-text-muted font-medium">Severity</label>
            <div className="flex gap-2">
              {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as IncidentSeverity[]).map((sev) => (
                <button
                  key={sev}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, severity: sev }))}
                  className={clsx(
                    "flex-1 py-1.5 rounded text-xs font-medium border transition-colors",
                    form.severity === sev
                      ? sev === "CRITICAL"
                        ? "bg-severity-critical/20 border-severity-critical/50 text-severity-critical"
                        : sev === "HIGH"
                        ? "bg-severity-high/20 border-severity-high/50 text-severity-high"
                        : sev === "MEDIUM"
                        ? "bg-severity-medium/20 border-severity-medium/50 text-severity-medium"
                        : "bg-severity-low/20 border-severity-low/50 text-severity-low"
                      : "border-border text-text-muted hover:bg-bg-hover"
                  )}
                >
                  {sev}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-text-muted font-medium">Description</label>
            <textarea
              className="input resize-none"
              rows={3}
              placeholder="Describe the incident… e.g. 'Investigate why payments-api latency increased in production'"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              required
              minLength={5}
              maxLength={500}
            />
          </div>

          {error && (
            <div className="text-xs text-severity-critical bg-severity-critical/10 border border-severity-critical/20 rounded p-2">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">
              Cancel
            </button>
            <button type="submit" disabled={creating} className="btn-primary flex-1 justify-center">
              {creating ? <><Spinner size="sm" /> Creating…</> : "Start Investigation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}
