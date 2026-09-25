// IncidentPilot — Incident Memory Repository
// Abstraction layer supporting both local/dev and Vectorize implementations
// Switch implementations by changing the factory at the bottom.

import type { IncidentMemory, Env } from "../types/index.js";
import { SEED_INCIDENTS } from "../services/simulated-infrastructure.js";
import { logger } from "../lib/logger.js";

// ─── Repository Interface ─────────────────────────────────────────────────────

export interface IncidentMemoryRepository {
  /**
   * Store a resolved incident for future retrieval.
   */
  storeIncident(incident: IncidentMemory): Promise<void>;

  /**
   * Search for similar past incidents using semantic or keyword similarity.
   */
  searchSimilarIncidents(
    service: string,
    symptoms: string[],
    limit?: number
  ): Promise<IncidentMemory[]>;

  /**
   * Retrieve a specific incident by ID.
   */
  getIncident(incidentId: string): Promise<IncidentMemory | null>;
}

// ─── In-Memory / Dev Implementation ──────────────────────────────────────────
// Used in local development or as fallback when Vectorize is unavailable.
// State is ephemeral (reset on Worker restart) — use R2-backed impl for production dev.

export class LocalMemoryRepository implements IncidentMemoryRepository {
  private incidents: Map<string, IncidentMemory>;

  constructor() {
    // Pre-seed with historical incidents
    this.incidents = new Map(
      SEED_INCIDENTS.map((incident) => [incident.incidentId, incident])
    );
  }

  async storeIncident(incident: IncidentMemory): Promise<void> {
    this.incidents.set(incident.incidentId, incident);
    logger.info("memory_store", {
      event: "memory_store",
      incidentId: incident.incidentId,
      metadata: { impl: "local", service: incident.service },
    });
  }

  async searchSimilarIncidents(
    service: string,
    symptoms: string[],
    limit = 3
  ): Promise<IncidentMemory[]> {
    const symptomsLower = symptoms.map((s) => s.toLowerCase());

    const scored = Array.from(this.incidents.values())
      .map((incident) => {
        let score = 0;
        const text = (incident.embeddingText ?? buildEmbeddingText(incident)).toLowerCase();

        if (incident.service === service) score += 0.5;
        else if (incident.service.split("-")[0] === service.split("-")[0]) score += 0.2;

        for (const symptom of symptomsLower) {
          if (text.includes(symptom)) score += 0.1;
          if (incident.symptoms.some((s) => s.toLowerCase().includes(symptom))) score += 0.15;
        }

        return { incident, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    logger.info("memory_search", {
      event: "memory_search",
      metadata: { impl: "local", service, symptomsCount: symptoms.length, resultCount: scored.length },
    });

    return scored.map((x) => ({ ...x.incident, similarity: x.score } as IncidentMemory));
  }

  async getIncident(incidentId: string): Promise<IncidentMemory | null> {
    return this.incidents.get(incidentId) ?? null;
  }
}

// ─── Vectorize Implementation ─────────────────────────────────────────────────
// Uses Cloudflare Vectorize for semantic similarity search.
// Falls back to keyword search if Vectorize is unavailable.

export class VectorizeMemoryRepository implements IncidentMemoryRepository {
  constructor(
    private vectorize: VectorizeIndex,
    private ai: Ai
  ) {}

  async storeIncident(incident: IncidentMemory): Promise<void> {
    const text = buildEmbeddingText(incident);

    try {
      // Generate embedding using Workers AI
      const embedding = await this.ai.run("@cf/baai/bge-base-en-v1.5", {
        text: [text],
      });

      const vectors = (embedding as { data: number[][] }).data;
      if (!vectors || vectors.length === 0) throw new Error("Empty embedding");

      const vectorId = `incident-${incident.incidentId}`;

      await this.vectorize.upsert([
        {
          id: vectorId,
          values: vectors[0]!,
          metadata: {
            incidentId: incident.incidentId,
            service: incident.service,
            environment: incident.environment,
            rootCause: incident.rootCause,
            remediation: incident.remediation,
            outcome: incident.outcome,
            createdAt: incident.timestamps.created,
          },
        },
      ]);

      logger.info("memory_store_vectorize", {
        event: "memory_store_vectorize",
        incidentId: incident.incidentId,
        metadata: { vectorId },
      });
    } catch (err) {
      logger.error("memory_store_vectorize_error", {
        event: "memory_store_vectorize_error",
        incidentId: incident.incidentId,
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
      // Don't throw — memory storage failure is non-fatal
    }
  }

  async searchSimilarIncidents(
    service: string,
    symptoms: string[],
    limit = 3
  ): Promise<IncidentMemory[]> {
    const query = `${service} ${symptoms.join(" ")}`;

    try {
      const embedding = await this.ai.run("@cf/baai/bge-base-en-v1.5", {
        text: [query],
      });

      const vectors = (embedding as { data: number[][] }).data;
      if (!vectors || vectors.length === 0) return this.fallbackSearch(service, symptoms, limit);

      const results = await this.vectorize.query(vectors[0]!, {
        topK: limit,
        returnMetadata: "all",
      });

      logger.info("memory_search_vectorize", {
        event: "memory_search_vectorize",
        metadata: { service, resultCount: results.matches.length },
      });

      return results.matches
        .filter((m) => m.score > 0.5)
        .map((m) => ({
          incidentId: (m.metadata?.incidentId as string) ?? "",
          service: (m.metadata?.service as string) ?? "",
          environment: (m.metadata?.environment as string) ?? "",
          symptoms: [],
          evidence: [],
          rootCause: (m.metadata?.rootCause as string) ?? "",
          confidence: m.score,
          remediation: (m.metadata?.remediation as string) ?? "",
          outcome: (m.metadata?.outcome as IncidentMemory["outcome"]) ?? "resolved",
          timestamps: { created: (m.metadata?.createdAt as string) ?? "" },
          similarity: m.score,
        }));
    } catch (err) {
      logger.warn("memory_search_vectorize_fallback", {
        event: "memory_search_vectorize_fallback",
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
      return this.fallbackSearch(service, symptoms, limit);
    }
  }

  private fallbackSearch(
    service: string,
    symptoms: string[],
    limit: number
  ): IncidentMemory[] {
    const local = new LocalMemoryRepository();
    // Synchronous fallback using the seed incidents
    return SEED_INCIDENTS.filter(
      (i) =>
        i.service === service ||
        symptoms.some((s) => i.symptoms.some((is) => is.toLowerCase().includes(s.toLowerCase())))
    ).slice(0, limit);
  }

  async getIncident(incidentId: string): Promise<IncidentMemory | null> {
    // Try to find in seed data first
    const seeded = SEED_INCIDENTS.find((i) => i.incidentId === incidentId);
    return seeded ?? null;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

// Singleton for local dev (shared across requests in same worker instance)
let localRepo: LocalMemoryRepository | null = null;

export function createMemoryRepository(env: Env): IncidentMemoryRepository {
  if (env.INCIDENT_VECTORS && env.AI) {
    try {
      return new VectorizeMemoryRepository(env.INCIDENT_VECTORS, env.AI);
    } catch {
      // Fall through to local
    }
  }

  // Use local in-memory implementation
  if (!localRepo) {
    localRepo = new LocalMemoryRepository();
  }
  return localRepo;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function buildEmbeddingText(incident: IncidentMemory): string {
  return [
    incident.service,
    incident.environment,
    ...incident.symptoms,
    incident.rootCause,
    incident.remediation,
    ...incident.evidence,
  ]
    .join(" ")
    .toLowerCase()
    .trim();
}
