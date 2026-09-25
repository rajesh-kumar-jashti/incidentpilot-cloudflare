// IncidentPilot — Structured Logger
// Emits JSON-structured logs for observability

import type { StructuredLog } from "../types/index.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let configuredLevel: LogLevel = "info";

export function setLogLevel(level: string): void {
  if (level in LOG_LEVELS) {
    configuredLevel = level as LogLevel;
  }
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[configuredLevel];
}

function emit(level: LogLevel, entry: StructuredLog): void {
  if (!shouldLog(level)) return;

  const output = JSON.stringify({
    level,
    ...entry,
    timestamp: entry.timestamp ?? new Date().toISOString(),
  });

  switch (level) {
    case "debug":
      console.debug(output);
      break;
    case "info":
      console.log(output);
      break;
    case "warn":
      console.warn(output);
      break;
    case "error":
      console.error(output);
      break;
  }
}

export const logger = {
  debug(event: string, meta?: Partial<StructuredLog>): void {
    emit("debug", { event, timestamp: new Date().toISOString(), ...meta });
  },
  info(event: string, meta?: Partial<StructuredLog>): void {
    emit("info", { event, timestamp: new Date().toISOString(), ...meta });
  },
  warn(event: string, meta?: Partial<StructuredLog>): void {
    emit("warn", { event, timestamp: new Date().toISOString(), ...meta });
  },
  error(event: string, meta?: Partial<StructuredLog>): void {
    emit("error", { event, timestamp: new Date().toISOString(), ...meta });
  },
};

export function createRequestLogger(requestId: string, incidentId?: string) {
  return {
    debug: (event: string, meta?: Partial<StructuredLog>) =>
      logger.debug(event, { requestId, incidentId, ...meta }),
    info: (event: string, meta?: Partial<StructuredLog>) =>
      logger.info(event, { requestId, incidentId, ...meta }),
    warn: (event: string, meta?: Partial<StructuredLog>) =>
      logger.warn(event, { requestId, incidentId, ...meta }),
    error: (event: string, meta?: Partial<StructuredLog>) =>
      logger.error(event, { requestId, incidentId, ...meta }),
  };
}
