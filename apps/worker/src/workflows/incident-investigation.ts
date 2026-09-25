// IncidentPilot — Incident Investigation Workflow
// Durable, multi-step workflow using Cloudflare Workflows
// Each step is independently retryable — transient failures don't restart the investigation

import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import type {
  Env,
  WorkflowParams,
  WorkflowStep as IncidentStepName,
  Evidence,
  LogEntry,
  MetricEvidence,
  LogEvidence,
  DeploymentEvidence,
  RootCauseAnalysis,
  RemediationProposal,
  RemediationResult,
  VerificationResult,
  IncidentReport,
  IncidentMemory,
} from "../types/index.js";
import {
  getServiceStatus,
  getMetrics,
  searchLogs,
  getRecentDeployments,
  compareVersions,
  getVerificationMetrics,
  getScenario,
} from "../services/simulated-infrastructure.js";
import { generateRemediationId, now, durationMs } from "../lib/utils.js";
import { logger } from "../lib/logger.js";

// ─── Workflow Class ────────────────────────────────────────────────────────────

export class IncidentInvestigationWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
  async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep): Promise<void> {
    const params = event.payload;
    const { incidentId, service, environment, description, agentId } = params;
    const scenario = params.scenario ?? getScenario(service, environment);
    const workflowStartMs = Date.now();

    logger.info("workflow_started", {
      event: "workflow_started",
      incidentId,
      workflowId: event.instanceId,
      metadata: { service, environment, scenario },
    });

    // Helper to notify the DO of step state changes
    const notifyStep = async (
      stepName: string,
      status: "running" | "completed" | "failed",
      extra: Record<string, unknown> = {}
    ) => {
      try {
        const doId = this.env.INCIDENT_DO.idFromName(incidentId);
        const doStub = this.env.INCIDENT_DO.get(doId);
        await doStub.fetch(
          new Request(`https://do/workflow-step`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              incidentId,
              step: stepName,
              status,
              startedAt: status === "running" ? now() : undefined,
              completedAt: status !== "running" ? now() : undefined,
              ...extra,
            }),
          })
        );
      } catch {
        // Non-fatal — don't block the workflow
      }
    };

    // ── Step 1: Create Incident ─────────────────────────────────────────────

    await step.do("create-incident", async () => {
      await notifyStep("create-incident", "running");
      const startMs = Date.now();

      const doId = this.env.INCIDENT_DO.idFromName(incidentId);
      const doStub = this.env.INCIDENT_DO.get(doId);

      await doStub.fetch(
        new Request(`https://do/incident`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: incidentId,
            service,
            environment,
            description,
            severity: params.severity,
            status: "INVESTIGATING",
            workflowId: event.instanceId,
            agentId,
            createdAt: now(),
            updatedAt: now(),
          }),
        })
      );

      await notifyStep("create-incident", "completed", { durationMs: durationMs(startMs) });
      return { incidentId };
    });

    // ── Step 2: Classify Incident ───────────────────────────────────────────

    const classification = await step.do(
      "classify-incident",
      { retries: { limit: 3, delay: "1 second", backoff: "exponential" } },
      async () => {
        await notifyStep("classify-incident", "running");
        const startMs = Date.now();

        // Use AI to classify the incident
        const prompt = `Classify this incident in 2-3 sentences. Service: ${service}, Environment: ${environment}. Description: "${description}". Return: {"category": "...", "initialHypothesis": "...", "priority": "HIGH|MEDIUM|LOW"}`;

        let category = "Performance Degradation";
        let initialHypothesis = "Service is experiencing degraded performance";

        try {
          const result = await this.env.AI.run(
            "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as Parameters<Ai["run"]>[0],
            {
              messages: [
                { role: "user", content: prompt },
              ] as never,
              max_tokens: 256,
            } as never
          ) as { response?: string };

          if (result.response) {
            const match = result.response.match(/\{[\s\S]*\}/);
            if (match) {
              const parsed = JSON.parse(match[0]);
              category = parsed.category ?? category;
              initialHypothesis = parsed.initialHypothesis ?? initialHypothesis;
            }
          }
        } catch {
          // Non-critical — use defaults
        }

        await notifyStep("classify-incident", "completed", { durationMs: durationMs(startMs) });
        return { category, initialHypothesis };
      }
    );

    // ── Step 3: Collect Service Status ──────────────────────────────────────

    const serviceStatusEvidence = await step.do(
      "collect-service-status",
      { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" } },
      async () => {
        await notifyStep("collect-service-status", "running");
        const startMs = Date.now();

        const status = getServiceStatus(service as never, environment as never, scenario);
        const evidence: Evidence = {
          type: "service_status",
          service: status.service,
          status: status.status,
          health: status.health,
          activeVersion: status.activeVersion,
          deploymentTimestamp: status.deploymentTimestamp,
        };

        await this.addEvidence(incidentId, evidence);
        await notifyStep("collect-service-status", "completed", { durationMs: durationMs(startMs) });
        return evidence;
      }
    );

    // ── Step 4: Collect Metrics ─────────────────────────────────────────────

    const metricsEvidence = (await step.do(
      "collect-metrics",
      { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" } },
      async () => {
        await notifyStep("collect-metrics", "running");
        const startMs = Date.now();

        const keyMetrics = ["p95_latency", "error_rate", "db_connections", "memory_usage"];
        const evidenceList: MetricEvidence[] = [];

        for (const metric of keyMetrics) {
          const m = getMetrics(service as never, environment as never, metric, scenario);
          const evidence: MetricEvidence = {
            type: "metric",
            name: metric,
            metric: m.metric,
            baseline: m.baseline,
            current: m.current,
            unit: m.unit,
            changePercent: m.changePercent,
            timestamp: now(),
          };
          evidenceList.push(evidence);
          await this.addEvidence(incidentId, evidence);
        }

        await notifyStep("collect-metrics", "completed", { durationMs: durationMs(startMs) });
        return evidenceList;
      }
    )) as MetricEvidence[];

    // ── Step 5: Collect Logs ────────────────────────────────────────────────

    const logsEvidence = (await step.do(
      "collect-logs",
      { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" } },
      async () => {
        await notifyStep("collect-logs", "running");
        const startMs = Date.now();

        const logs = searchLogs(service as never, environment as never, "error", 15, scenario);
        const evidence: LogEvidence = {
          type: "log",
          entries: logs,
          query: "error",
          timestamp: now(),
        };

        await this.addEvidence(incidentId, evidence);
        await notifyStep("collect-logs", "completed", { durationMs: durationMs(startMs) });
        return evidence;
      }
    )) as LogEvidence;

    // ── Step 6: Inspect Deployments ─────────────────────────────────────────

    const deployments = (await step.do(
      "inspect-deployments",
      { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" } },
      async () => {
        await notifyStep("inspect-deployments", "running");
        const startMs = Date.now();

        const deps = getRecentDeployments(service as never, environment as never, scenario);
        if (deps.length > 0) {
          const latestDep = deps[0]!;
          const evidence: Evidence = {
            type: "deployment",
            version: latestDep.version,
            previousVersion: latestDep.previousVersion,
            deployedAt: latestDep.deployedAt,
            changes: latestDep.changes,
            configChanges: latestDep.configChanges,
            deployedBy: latestDep.deployedBy,
            durationMinutesBeforeIncident: Math.round(
              (Date.now() - new Date(latestDep.deployedAt).getTime()) / 60000
            ),
          };
          await this.addEvidence(incidentId, evidence);
        }

        await notifyStep("inspect-deployments", "completed", { durationMs: durationMs(startMs) });
        return deps;
      }
    )) as any[];

    // ── Step 7: Compare Versions ────────────────────────────────────────────

    const versionDiff = await step.do(
      "compare-versions",
      { retries: { limit: 2, delay: "1 second" } },
      async () => {
        await notifyStep("compare-versions", "running");
        const startMs = Date.now();

        let diff = null;
        if (deployments.length > 0) {
          const dep = deployments[0]!;
          diff = compareVersions(service as never, dep.previousVersion, dep.version);
        }

        await notifyStep("compare-versions", "completed", { durationMs: durationMs(startMs) });
        return diff;
      }
    );

    // ── Step 8: Retrieve Historical Incidents ───────────────────────────────

    const historicalIncidents = (await step.do(
      "retrieve-historical-incidents",
      { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" } },
      async () => {
        await notifyStep("retrieve-historical-incidents", "running");
        const startMs = Date.now();

        // Build symptom list from collected evidence
        const symptoms: string[] = [];
        for (const m of metricsEvidence) {
          if (m.changePercent > 50) {
            symptoms.push(`high ${m.metric}`);
          }
        }
        if (logsEvidence.entries.some((l: LogEntry) => l.level === "ERROR")) {
          symptoms.push("error rate increase");
        }

        // Search local memory — in production uses Vectorize
        const { SEED_INCIDENTS } = await import("../services/simulated-infrastructure.js");
        const similar = SEED_INCIDENTS.filter(
          (i) =>
            i.service === service ||
            symptoms.some((s) => i.symptoms.some((is) => is.toLowerCase().includes(s.toLowerCase())))
        ).slice(0, 3);

        for (const incident of similar) {
          const evidence: Evidence = {
            type: "historical_incident",
            incidentId: incident.incidentId,
            service: incident.service,
            rootCause: incident.rootCause,
            resolution: incident.remediation,
            symptoms: incident.symptoms,
            occurredAt: incident.timestamps.created,
          };
          await this.addEvidence(incidentId, evidence);
        }

        await notifyStep("retrieve-historical-incidents", "completed", { durationMs: durationMs(startMs) });
        return similar;
      }
    )) as any[];

    // ── Step 9: Correlate Evidence ──────────────────────────────────────────

    await step.do("correlate-evidence", async () => {
      await notifyStep("correlate-evidence", "running");
      const startMs = Date.now();
      // Evidence is already collected — this step signals correlation phase
      await step.sleep("correlation-delay", "1 second");
      await notifyStep("correlate-evidence", "completed", { durationMs: durationMs(startMs) });
    });

    // ── Step 10: Root Cause Analysis ────────────────────────────────────────

    const rca = (await step.do(
      "root-cause-analysis",
      { retries: { limit: 2, delay: "3 seconds", backoff: "exponential" } },
      async () => {
        await notifyStep("root-cause-analysis", "running");
        const startMs = Date.now();

        const evidenceSummary = this.buildEvidenceSummary(
          metricsEvidence,
          logsEvidence,
          deployments,
          versionDiff,
          historicalIncidents
        );

        const rcaResult = await this.performRCA(evidenceSummary, service, description);

        const doId = this.env.INCIDENT_DO.idFromName(incidentId);
        const doStub = this.env.INCIDENT_DO.get(doId);
        await doStub.fetch(
          new Request(`https://do/rca`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ incidentId, rca: rcaResult }),
          })
        );

        await notifyStep("root-cause-analysis", "completed", { durationMs: durationMs(startMs) });
        return rcaResult;
      }
    )) as RootCauseAnalysis;

    // ── Step 11: Generate Remediation ───────────────────────────────────────

    const remediation = (await step.do(
      "generate-remediation",
      { retries: { limit: 2, delay: "2 seconds" } },
      async () => {
        await notifyStep("generate-remediation", "running");
        const startMs = Date.now();

        const proposal = this.generateRemediationProposal(incidentId, rca, scenario);

        const doId = this.env.INCIDENT_DO.idFromName(incidentId);
        const doStub = this.env.INCIDENT_DO.get(doId);
        await doStub.fetch(
          new Request(`https://do/remediation`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ incidentId, remediation: proposal }),
          })
        );

        await notifyStep("generate-remediation", "completed", { durationMs: durationMs(startMs) });
        return proposal;
      }
    )) as RemediationProposal;

    // ── Step 12: Wait for Human Approval ────────────────────────────────────
    // CRITICAL: Workflow pauses here until explicit human action

    await notifyStep("wait-for-human-approval", "running");

    const approvalResult = await step.waitForEvent<{
      approved: boolean;
      approvedBy?: string;
    }>("approval", {
      type: "approval",
      timeout: Number(this.env.APPROVAL_TIMEOUT_SECONDS ?? 300) * 1000,
    });

    if (!approvalResult || !approvalResult.payload.approved) {
      // Approval expired or rejected
      const isExpired = !approvalResult;
      const status = isExpired ? "APPROVAL_EXPIRED" : "REJECTED";

      await this.updateIncidentStatus(incidentId, status);
      await notifyStep("wait-for-human-approval", "completed", {
        durationMs: durationMs(workflowStartMs),
      });

      logger.info("workflow_approval_rejected", {
        event: "workflow_approval_rejected",
        incidentId,
        metadata: { expired: isExpired, status },
      });
      return;
    }

    await notifyStep("wait-for-human-approval", "completed");

    // ── Step 13: Execute Remediation ────────────────────────────────────────
    // Only reached after explicit human approval

    const remediationResult = (await step.do(
      "execute-remediation",
      { retries: { limit: 1, delay: "1 second" } }, // Only retry once — idempotency key protects against double-exec
      async () => {
        await notifyStep("execute-remediation", "running");
        const startMs = Date.now();

        // Check idempotency — don't execute twice
        const doId = this.env.INCIDENT_DO.idFromName(incidentId);
        const doStub = this.env.INCIDENT_DO.get(doId);
        const stateRes = await doStub.fetch(
          new Request(`https://do/state`, { method: "GET" })
        );
        const state = await stateRes.json() as { remediation?: { status?: string; executedAt?: string } };

        if (state.remediation?.status === "EXECUTED") {
          logger.info("remediation_idempotent_skip", {
            event: "remediation_idempotent_skip",
            incidentId,
            metadata: { executedAt: state.remediation.executedAt },
          });
          return { success: true, action: "Already executed (idempotent)", simulated: true as const, timestamp: state.remediation.executedAt ?? now() };
        }

        const result = {
          success: true,
          action: `Remediation executed: ${remediation.title}`,
          details: `Applied change: ${remediation.proposedValue ?? remediation.action}`,
          timestamp: now(),
          simulated: true as const,
        };

        await doStub.fetch(
          new Request(`https://do/remediation-result`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              incidentId,
              remediationId: remediation.remediationId,
              result,
            }),
          })
        );

        await notifyStep("execute-remediation", "completed", { durationMs: durationMs(startMs) });
        return result;
      }
    )) as RemediationResult;

    // ── Step 14: Verify Recovery ────────────────────────────────────────────

    const verification = (await step.do(
      "verify-recovery",
      { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
      async () => {
        await notifyStep("verify-recovery", "running");
        const startMs = Date.now();

        // Wait for metrics to stabilize
        await step.sleep("recovery-stabilization", "5 seconds");

        const metrics = getVerificationMetrics(service as never, environment as never, scenario);
        const result: VerificationResult = {
          success: metrics.improved,
          metricsImproved: metrics.improved,
          details: metrics.improved
            ? "All key metrics returned to normal baseline. Service is healthy."
            : "Metrics have not yet improved. Consider escalation.",
          beforeMetrics: metrics.before,
          afterMetrics: metrics.after,
          timestamp: now(),
        };

        await notifyStep("verify-recovery", "completed", { durationMs: durationMs(startMs) });
        return result;
      }
    )) as VerificationResult;

    // ── Step 15: Generate Report ─────────────────────────────────────────────

    const reportKey = await step.do(
      "generate-report",
      { retries: { limit: 2, delay: "2 seconds" } },
      async () => {
        await notifyStep("generate-report", "running");
        const startMs = Date.now();

        const report: IncidentReport = {
          incidentId,
          generatedAt: now(),
          executiveSummary: `${service} experienced ${rca.rootCause.slice(0, 100)} in ${environment}. ` +
            `The incident was resolved after ${Math.round(durationMs(workflowStartMs) / 60000)} minutes.`,
          impact: `Service degraded: health dropped to ${serviceStatusEvidence.health}%. ` +
            `${metricsEvidence.filter((m: MetricEvidence) => m.changePercent > 50).map((m: MetricEvidence) => `${m.metric} increased by ${m.changePercent}%`).join(", ")}`,
          timeline: this.buildTimeline(deployments, metricsEvidence, logsEvidence),
          observedEvidence: [...metricsEvidence, logsEvidence, serviceStatusEvidence],
          rootCause: rca,
          alternativeHypotheses: rca.alternativeHypotheses,
          remediation,
          remediationResult,
          verification,
          lessonsLearned: this.generateLessonsLearned(rca, scenario),
        };

        // Store in R2
        const key = `incidents/${incidentId}/report.json`;
        try {
          await this.env.INCIDENT_REPORTS.put(key, JSON.stringify(report, null, 2), {
            httpMetadata: { contentType: "application/json" },
            customMetadata: { incidentId, service, environment, generatedAt: now() },
          });
          report.r2Key = key;
        } catch (err) {
          logger.warn("r2_store_error", {
            event: "r2_store_error",
            incidentId,
            metadata: { error: err instanceof Error ? err.message : String(err) },
          });
        }

        const doId = this.env.INCIDENT_DO.idFromName(incidentId);
        const doStub = this.env.INCIDENT_DO.get(doId);
        await doStub.fetch(
          new Request(`https://do/report`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ incidentId, reportKey: key }),
          })
        );

        await notifyStep("generate-report", "completed", { durationMs: durationMs(startMs) });
        return key;
      }
    );

    // ── Step 16: Persist Incident Memory ────────────────────────────────────

    await step.do(
      "persist-incident-memory",
      { retries: { limit: 3, delay: "2 seconds" } },
      async () => {
        await notifyStep("persist-incident-memory", "running");
        const startMs = Date.now();

        const memory: IncidentMemory = {
          incidentId,
          service,
          environment,
          symptoms: metricsEvidence
            .filter((m: MetricEvidence) => m.changePercent > 50)
            .map((m: MetricEvidence) => `${m.metric} increased by ${m.changePercent}%`),
          evidence: [
            rca.rootCause,
            ...rca.evidence,
          ],
          rootCause: rca.rootCause,
          confidence: rca.confidence,
          remediation: remediation.title,
          outcome: verification.success ? "resolved" : "failed",
          timestamps: {
            created: now(),
            resolved: now(),
          },
          embeddingText: [service, environment, ...rca.evidence, rca.rootCause].join(" "),
        };

        // Try to store in Vectorize via the memory module
        try {
          const { createMemoryRepository } = await import("../memory/incident-memory.js");
          const repo = createMemoryRepository(this.env);
          await repo.storeIncident(memory);
        } catch (err) {
          logger.warn("memory_persist_error", {
            event: "memory_persist_error",
            incidentId,
            metadata: { error: err instanceof Error ? err.message : String(err) },
          });
        }

        await notifyStep("persist-incident-memory", "completed", {
          durationMs: durationMs(startMs),
        });
      }
    );

    logger.info("workflow_completed", {
      event: "workflow_completed",
      incidentId,
      workflowId: event.instanceId,
      metadata: {
        totalDurationMs: durationMs(workflowStartMs),
        resolved: verification.success,
      },
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async addEvidence(incidentId: string, evidence: Evidence): Promise<void> {
    try {
      const doId = this.env.INCIDENT_DO.idFromName(incidentId);
      const doStub = this.env.INCIDENT_DO.get(doId);
      await doStub.fetch(
        new Request(`https://do/evidence`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ incidentId, evidence }),
        })
      );
    } catch {
      // Non-fatal
    }
  }

  private async updateIncidentStatus(incidentId: string, status: string): Promise<void> {
    try {
      const doId = this.env.INCIDENT_DO.idFromName(incidentId);
      const doStub = this.env.INCIDENT_DO.get(doId);
      await doStub.fetch(
        new Request(`https://do/incident`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: incidentId, status }),
        })
      );
    } catch {
      // Non-fatal
    }
  }

  private buildEvidenceSummary(
    metrics: Evidence[],
    logs: Evidence,
    deployments: ReturnType<typeof getRecentDeployments>,
    versionDiff: ReturnType<typeof compareVersions> | null,
    historical: unknown[]
  ): string {
    const parts: string[] = ["Evidence summary for root cause analysis:"];

    if (metrics.length > 0) {
      parts.push("\nMetrics:");
      for (const m of metrics) {
        if (m.type === "metric") {
          parts.push(`- ${m.metric}: baseline=${m.baseline}${m.unit}, current=${m.current}${m.unit}, change=${m.changePercent}%`);
        }
      }
    }

    if (logs.type === "log" && logs.entries.length > 0) {
      parts.push("\nRecent error logs:");
      logs.entries
        .filter((l) => l.level === "ERROR" || l.level === "WARN")
        .slice(0, 5)
        .forEach((l) => parts.push(`- [${l.level}] ${l.message}`));
    }

    if (deployments.length > 0) {
      const dep = deployments[0]!;
      parts.push(`\nMost recent deployment: ${dep.version} (${dep.previousVersion} → ${dep.version}), deployed ${Math.round((Date.now() - new Date(dep.deployedAt).getTime()) / 60000)} minutes ago`);
      if (dep.configChanges.length > 0) {
        parts.push("Config changes: " + dep.configChanges.join(", "));
      }
    }

    if (versionDiff) {
      parts.push(`\nVersion diff risk: ${versionDiff.riskLevel} — ${versionDiff.riskReason}`);
    }

    return parts.join("\n");
  }

  private async performRCA(
    evidenceSummary: string,
    service: string,
    description: string
  ): Promise<RootCauseAnalysis> {
    const prompt = `You are an expert SRE analyzing a production incident.

Incident: ${description}
Service: ${service}

${evidenceSummary}

Produce a root cause analysis. Respond ONLY with valid JSON:
{
  "rootCause": "Brief, specific root cause (1-2 sentences)",
  "confidence": 0.87,
  "evidence": ["evidence point 1", "evidence point 2", "evidence point 3"],
  "alternativeHypotheses": [{"hypothesis": "...", "whyLessSupported": "..."}],
  "recommendedAction": "Specific recommended action"
}

Note: confidence is your AI-estimated probability (0-1), not a statistical fact. Be conservative.
IMPORTANT: Only use evidence provided above. Do not invent facts.`;

    try {
      const result = await this.env.AI.run(
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as Parameters<Ai["run"]>[0],
        {
          messages: [{ role: "user", content: prompt }] as never,
          max_tokens: 1024,
          temperature: 0.1,
        } as never
      ) as { response?: string };

      if (result.response) {
        const match = result.response.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]) as RootCauseAnalysis;
          if (parsed.rootCause && parsed.confidence !== undefined) {
            return parsed;
          }
        }
      }
    } catch (err) {
      logger.error("rca_llm_error", {
        event: "rca_llm_error",
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
    }

    // Fallback RCA based on scenario
    return this.fallbackRCA(evidenceSummary);
  }

  private fallbackRCA(evidenceSummary: string): RootCauseAnalysis {
    // Parse evidence to determine most likely cause
    if (evidenceSummary.includes("DB_MAX_CONNECTIONS") || evidenceSummary.includes("connection pool")) {
      return {
        rootCause: "Database connection pool exhaustion caused by configuration change reducing maximum connections",
        confidence: 0.87,
        evidence: [
          "DB connections increased from baseline to near-maximum",
          "p95 latency spiked after recent deployment",
          "Deployment changed DB_MAX_CONNECTIONS configuration",
          "5xx error rate correlates with connection exhaustion",
        ],
        alternativeHypotheses: [
          {
            hypothesis: "Database server overload",
            whyLessSupported: "Database server metrics remain within normal range; no DB-side alerts.",
          },
        ],
        recommendedAction: "Increase DB_MAX_CONNECTIONS and redeploy",
      };
    }

    if (evidenceSummary.includes("memory") || evidenceSummary.includes("CACHE_TTL")) {
      return {
        rootCause: "Memory leak introduced by unbounded in-memory caching in latest deployment",
        confidence: 0.89,
        evidence: [
          "Memory usage increased gradually over 45 minutes",
          "Deployment introduced 24h cache TTL (was 60s)",
          "GC pauses increased significantly",
          "Service restarts correlate with OOM events",
        ],
        alternativeHypotheses: [
          {
            hypothesis: "Traffic spike causing memory pressure",
            whyLessSupported: "Request rate has not increased; memory grows even during low traffic.",
          },
        ],
        recommendedAction: "Roll back to previous version and add cache eviction policy",
      };
    }

    if (evidenceSummary.includes("identity-provider") || evidenceSummary.includes("external")) {
      return {
        rootCause: "External identity provider outage causing authentication timeout cascade",
        confidence: 0.92,
        evidence: [
          "Downstream identity-provider-api returning 503",
          "No recent auth-api deployments (3 days ago)",
          "Auth-api internal metrics are normal",
          "Circuit breaker triggered by external failures",
        ],
        alternativeHypotheses: [
          {
            hypothesis: "Auth-api application bug",
            whyLessSupported: "Auth-api code and infrastructure unchanged. Failure pattern matches external provider.",
          },
        ],
        recommendedAction: "Contact identity-provider team and enable circuit breaker with cached fallback",
      };
    }

    return {
      rootCause: "Service degradation under investigation — insufficient evidence for high-confidence RCA",
      confidence: 0.45,
      evidence: ["Multiple anomalies detected", "Root cause unclear from available data"],
      alternativeHypotheses: [],
      recommendedAction: "Gather additional metrics and logs before proceeding",
    };
  }

  private generateRemediationProposal(
    incidentId: string,
    rca: RootCauseAnalysis,
    scenario: string
  ): RemediationProposal {
    const remediationId = generateRemediationId();
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();

    if (scenario === "db-connection-exhaustion" || rca.rootCause.toLowerCase().includes("connection pool")) {
      return {
        remediationId,
        incidentId,
        title: "Increase Database Connection Pool Size",
        description: "Increase DB_MAX_CONNECTIONS from 100 to 200 to restore database connection capacity.",
        action: "UPDATE_CONFIG",
        currentValue: "DB_MAX_CONNECTIONS=100",
        proposedValue: "DB_MAX_CONNECTIONS=200",
        reason: rca.rootCause,
        estimatedImpact: "Resolves connection exhaustion immediately upon deployment. p95 latency expected to return to ~0.42s within 2 minutes.",
        risk: "LOW",
        status: "PENDING",
        createdAt: now(),
        expiresAt,
      };
    }

    if (scenario === "memory-leak" || rca.rootCause.toLowerCase().includes("memory")) {
      return {
        remediationId,
        incidentId,
        title: "Roll Back to v3.0.9",
        description: "Roll back checkout-api from v3.1.0 to v3.0.9 to eliminate the memory leak introduced in v3.1.0.",
        action: "ROLLBACK",
        currentValue: "version: 3.1.0",
        proposedValue: "version: 3.0.9",
        reason: rca.rootCause,
        estimatedImpact: "Memory will stabilize within 5-10 minutes after rollback. Cache warm-up required.",
        risk: "MEDIUM",
        status: "PENDING",
        createdAt: now(),
        expiresAt,
      };
    }

    if (scenario === "external-dependency" || rca.rootCause.toLowerCase().includes("external")) {
      return {
        remediationId,
        incidentId,
        title: "Enable Circuit Breaker with Cached Fallback",
        description: "Enable the circuit breaker for identity-provider-api with a 60-second cached token fallback to reduce user impact.",
        action: "ENABLE_CIRCUIT_BREAKER",
        currentValue: "CIRCUIT_BREAKER=false, FALLBACK_AUTH=disabled",
        proposedValue: "CIRCUIT_BREAKER=true, FALLBACK_AUTH=cached-60s",
        reason: rca.rootCause,
        estimatedImpact: "Immediately reduces 503 errors for users with cached valid tokens. Full resolution when identity provider recovers.",
        risk: "LOW",
        status: "PENDING",
        createdAt: now(),
        expiresAt,
      };
    }

    return {
      remediationId,
      incidentId,
      title: "Manual Investigation Required",
      description: "Root cause could not be determined with high confidence. Manual investigation required.",
      action: "MANUAL",
      reason: rca.rootCause,
      estimatedImpact: "Unknown",
      risk: "HIGH",
      status: "PENDING",
      createdAt: now(),
      expiresAt,
    };
  }

  private buildTimeline(
    deployments: ReturnType<typeof getRecentDeployments>,
    metrics: Evidence[],
    logs: Evidence
  ): Array<{ timestamp: string; event: string }> {
    const events: Array<{ timestamp: string; event: string }> = [];

    if (deployments.length > 0 && deployments[0]) {
      events.push({
        timestamp: deployments[0].deployedAt,
        event: `Deployment ${deployments[0].version} completed`,
      });
    }

    if (logs.type === "log") {
      logs.entries
        .filter((l) => l.level === "ERROR" || l.level === "WARN")
        .slice(0, 5)
        .forEach((l) =>
          events.push({
            timestamp: l.timestamp,
            event: `[${l.level}] ${l.message.slice(0, 100)}`,
          })
        );
    }

    return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  private generateLessonsLearned(rca: RootCauseAnalysis, scenario: string): string[] {
    const lessons: string[] = [
      "Add automated canary deployment with latency-based rollback triggers.",
    ];

    if (scenario === "db-connection-exhaustion") {
      lessons.push(
        "Require database configuration changes to be reviewed by a DBA before deployment.",
        "Add Prometheus alert for DB connection pool utilization > 80%.",
        "Include connection pool size in deployment diff review checklist."
      );
    } else if (scenario === "memory-leak") {
      lessons.push(
        "Enforce cache TTL bounds in code review (maximum 1 hour).",
        "Add memory usage alert at 80% of container limit.",
        "Profile memory in staging before production deployment."
      );
    } else if (scenario === "external-dependency") {
      lessons.push(
        "Implement circuit breakers for all external dependency calls.",
        "Add synthetic monitoring for critical external endpoints.",
        "Create SLA agreement with identity provider including incident escalation path."
      );
    }

    return lessons;
  }
}
