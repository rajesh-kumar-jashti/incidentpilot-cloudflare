// IncidentPilot — Root Cause Analysis Panel

import React from "react";
import { clsx } from "clsx";
import type { RootCauseAnalysis } from "../types/index.js";
import { ConfidenceBar } from "./ui.js";

interface RCAPanelProps {
  rca: RootCauseAnalysis;
}

export function RCAPanel({ rca }: RCAPanelProps) {
  return (
    <div className="space-y-4 animate-in">
      {/* Root Cause */}
      <div className="card p-4 space-y-3">
        <div className="section-header">Root Cause</div>
        <p className="text-sm text-text-primary font-medium leading-relaxed">{rca.rootCause}</p>
        <ConfidenceBar confidence={rca.confidence} />
      </div>

      {/* Evidence */}
      {rca.evidence.length > 0 && (
        <div className="card p-4 space-y-2">
          <div className="section-header">Supporting Evidence</div>
          <ul className="space-y-1.5">
            {rca.evidence.map((e, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                <svg className="w-4 h-4 text-status-resolved flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Alternative Hypotheses */}
      {rca.alternativeHypotheses.length > 0 && (
        <div className="card p-4 space-y-3">
          <div className="section-header">Alternative Hypotheses</div>
          {rca.alternativeHypotheses.map((alt, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-start gap-2">
                <svg className="w-4 h-4 text-text-muted flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm text-text-secondary">{alt.hypothesis}</span>
              </div>
              <p className="text-xs text-text-muted ml-6 italic">
                Why less supported: {alt.whyLessSupported}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Recommended Action */}
      {rca.recommendedAction && (
        <div className="bg-brand/5 border border-brand/20 rounded-lg p-4 space-y-1">
          <div className="text-xs font-semibold text-brand uppercase tracking-wide">Recommended Action</div>
          <p className="text-sm text-text-secondary">{rca.recommendedAction}</p>
        </div>
      )}
    </div>
  );
}
