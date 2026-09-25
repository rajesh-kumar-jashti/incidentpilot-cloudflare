// IncidentPilot — Main Worker Entry Point
// Routes requests to appropriate handlers, exports Durable Objects and Workflows

import type { Env } from "./types/index.js";
import { setLogLevel } from "./lib/logger.js";
import { generateRequestId } from "./lib/utils.js";
import {
  handleHealth,
  handleCreateIncident,
  handleAgentChat,
  handleGetIncidentState,
  handleWebSocket,
  handleApproval,
  handleGetReport,
  handleDemoIncident,
} from "./routes/api.js";

// ─── Export Durable Objects ────────────────────────────────────────────────────

export { IncidentDurableObject } from "./agents/incident-do.js";
export { IncidentAgent } from "./agents/incident-agent.js";

// ─── Export Workflow ───────────────────────────────────────────────────────────

export { IncidentInvestigationWorkflow } from "./workflows/incident-investigation.js";

// ─── CORS Headers ─────────────────────────────────────────────────────────────

function addCORS(response: Response, origin: string): Response {
  const headers = new Headers(response.headers);
  const allowedOrigins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "https://incidentpilot.pages.dev",
  ];

  if (allowedOrigins.includes(origin) || origin.endsWith(".pages.dev")) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Request-ID"
    );
    headers.set("Access-Control-Max-Age", "86400");
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  return new Response(response.body, { status: response.status, headers });
}

// ─── Security Headers ──────────────────────────────────────────────────────────

function addSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-XSS-Protection", "1; mode=block");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return new Response(response.body, { status: response.status, headers });
}

// ─── Router ────────────────────────────────────────────────────────────────────

function matchRoute(
  method: string,
  pathname: string
): { handler: string; params: Record<string, string> } | null {
  const routes: Array<{
    method: string;
    pattern: RegExp;
    handler: string;
    paramNames: string[];
  }> = [
    { method: "GET", pattern: /^\/health$/, handler: "health", paramNames: [] },
    { method: "POST", pattern: /^\/api\/incidents$/, handler: "createIncident", paramNames: [] },
    {
      method: "GET",
      pattern: /^\/api\/incidents\/([^/]+)\/state$/,
      handler: "getIncidentState",
      paramNames: ["incidentId"],
    },
    {
      method: "POST",
      pattern: /^\/api\/incidents\/([^/]+)\/chat$/,
      handler: "agentChat",
      paramNames: ["incidentId"],
    },
    {
      method: "GET",
      pattern: /^\/api\/incidents\/([^/]+)\/ws$/,
      handler: "webSocket",
      paramNames: ["incidentId"],
    },
    {
      method: "POST",
      pattern: /^\/api\/incidents\/([^/]+)\/approval$/,
      handler: "approval",
      paramNames: ["incidentId"],
    },
    {
      method: "GET",
      pattern: /^\/api\/incidents\/([^/]+)\/report$/,
      handler: "getReport",
      paramNames: ["incidentId"],
    },
    {
      method: "POST",
      pattern: /^\/api\/demo\/([^/]+)$/,
      handler: "demoIncident",
      paramNames: ["scenario"],
    },
  ];

  for (const route of routes) {
    if (route.method !== method) continue;
    const match = pathname.match(route.pattern);
    if (match) {
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = match[i + 1] ?? "";
      });
      return { handler: route.handler, params };
    }
  }

  return null;
}

// ─── Main Handler ──────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Configure logging
    setLogLevel(env.LOG_LEVEL ?? "info");

    const url = new URL(request.url);
    const origin = request.headers.get("Origin") ?? "";
    const requestId = generateRequestId();

    // CORS preflight
    if (request.method === "OPTIONS") {
      return addCORS(
        new Response(null, { status: 204 }),
        origin
      );
    }

    let response: Response;

    try {
      const route = matchRoute(request.method, url.pathname);

      if (!route) {
        // Serve static assets for anything that isn't an API route
        // In production, these are served by Cloudflare Pages
        if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/health")) {
          response = new Response("IncidentPilot API. Frontend served separately.", {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          });
        } else {
          response = new Response(
            JSON.stringify({ success: false, error: "Not Found", requestId }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }
      } else {
        const { handler, params } = route;

        switch (handler) {
          case "health":
            response = await handleHealth(request, env, ctx);
            break;
          case "createIncident":
            response = await handleCreateIncident(request, env, ctx);
            break;
          case "getIncidentState":
            response = await handleGetIncidentState(request, env, params["incidentId"]!);
            break;
          case "agentChat":
            response = await handleAgentChat(request, env, params["incidentId"]!);
            break;
          case "webSocket":
            response = await handleWebSocket(request, env, params["incidentId"]!);
            break;
          case "approval":
            response = await handleApproval(request, env, params["incidentId"]!);
            break;
          case "getReport":
            response = await handleGetReport(request, env, params["incidentId"]!);
            break;
          case "demoIncident":
            response = await handleDemoIncident(request, env, params["scenario"]!);
            break;
          default:
            response = new Response("Not Found", { status: 404 });
        }
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "unhandled_error",
          requestId,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
          timestamp: new Date().toISOString(),
        })
      );

      response = new Response(
        JSON.stringify({
          success: false,
          error: "Internal server error",
          requestId,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return addSecurityHeaders(addCORS(response, origin));
  },
};
