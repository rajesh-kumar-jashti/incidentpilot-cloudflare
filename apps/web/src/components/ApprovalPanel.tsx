// IncidentPilot — Approval Panel
// Critical human-in-the-loop component — displayed when workflow pauses

import React, { useState } from "react";
import { clsx } from "clsx";
import type { RemediationProposal } from "../types/index.js";
import { submitApproval } from "../lib/api.js";

interface ApprovalPanelProps {
  incidentId: string;
  remediation: RemediationProposal;
  onDecision: (approved: boolean) => void;
}

export function ApprovalPanel({ incidentId, remediation, onDecision }: ApprovalPanelProps) {
  const [submitting, setSubmitting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expiresAt = new Date(remediation.expiresAt);
  const isExpired = expiresAt < new Date();

  const handleApprove = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await submitApproval(incidentId, remediation.remediationId, true);
      onDecision(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve");
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim() && showRejectInput) {
      setShowRejectInput(false);
      return;
    }
    if (!showRejectInput) {
      setShowRejectInput(true);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await submitApproval(incidentId, remediation.remediationId, false, rejectReason);
      onDecision(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject");
      setSubmitting(false);
    }
  };

  const riskColors = {
    LOW: "text-status-resolved border-status-resolved/30 bg-status-resolved/5",
    MEDIUM: "text-severity-medium border-severity-medium/30 bg-severity-medium/5",
    HIGH: "text-severity-critical border-severity-critical/30 bg-severity-critical/5",
  }[remediation.risk];

  return (
    <div className="border border-status-waiting/40 bg-status-waiting/5 rounded-lg overflow-hidden animate-slide-up">
      {/* Header */}
      <div className="px-4 py-3 border-b border-status-waiting/20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-status-waiting animate-pulse-slow" />
          <span className="text-sm font-semibold text-text-primary">Remediation Approval Required</span>
        </div>
        <span className={clsx("text-xs px-2 py-0.5 rounded border font-medium", riskColors)}>
          {remediation.risk} RISK
        </span>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Title & Description */}
        <div>
          <h3 className="text-sm font-semibold text-text-primary">{remediation.title}</h3>
          <p className="text-xs text-text-secondary mt-1">{remediation.description}</p>
        </div>

        {/* Change visualization */}
        {(remediation.currentValue || remediation.proposedValue) && (
          <div className="grid grid-cols-2 gap-2">
            {remediation.currentValue && (
              <div className="bg-severity-critical/5 border border-severity-critical/20 rounded p-2">
                <div className="text-xs text-text-muted mb-1">Current</div>
                <code className="text-xs font-mono text-severity-critical">{remediation.currentValue}</code>
              </div>
            )}
            {remediation.proposedValue && (
              <div className="bg-status-resolved/5 border border-status-resolved/20 rounded p-2">
                <div className="text-xs text-text-muted mb-1">Proposed</div>
                <code className="text-xs font-mono text-status-resolved">{remediation.proposedValue}</code>
              </div>
            )}
          </div>
        )}

        {/* Impact */}
        <div className="bg-bg-secondary rounded p-3 space-y-1">
          <div className="text-xs text-text-muted font-semibold uppercase tracking-wide">Expected Impact</div>
          <p className="text-xs text-text-secondary">{remediation.estimatedImpact}</p>
        </div>

        {/* Reason */}
        <div>
          <div className="text-xs text-text-muted font-semibold uppercase tracking-wide mb-1">Root Cause</div>
          <p className="text-xs text-text-secondary italic">{remediation.reason.slice(0, 200)}{remediation.reason.length > 200 ? "…" : ""}</p>
        </div>

        {/* Expiry */}
        {!isExpired && (
          <div className="text-xs text-text-muted">
            Approval expires: <span className="font-mono">{expiresAt.toLocaleString()}</span>
          </div>
        )}

        {isExpired && (
          <div className="text-xs text-severity-critical font-semibold">
            ⚠ Approval window has expired. Remediation will not be executed.
          </div>
        )}

        {error && (
          <div className="text-xs text-severity-critical bg-severity-critical/10 border border-severity-critical/20 rounded p-2">
            {error}
          </div>
        )}

        {/* Reject reason */}
        {showRejectInput && (
          <textarea
            className="input resize-none text-xs"
            rows={2}
            placeholder="Reason for rejection (optional)…"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
        )}

        {/* Actions */}
        {!isExpired && (
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleReject}
              disabled={submitting}
              className="btn-danger flex-1 justify-center"
            >
              {showRejectInput ? "Confirm Reject" : "Reject"}
            </button>
            <button
              onClick={handleApprove}
              disabled={submitting || isExpired}
              className="btn-success flex-1 justify-center"
            >
              {submitting ? "Processing…" : "Approve"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
