// IncidentPilot — WebSocket Hook
// Real-time connection to Incident Durable Object with reconnection

import { useEffect, useRef, useCallback, useState } from "react";
import type { WorkflowEvent } from "../types/index.js";
import { createWebSocket } from "../lib/api.js";

interface UseWebSocketOptions {
  incidentId: string | null;
  onEvent: (event: WorkflowEvent) => void;
  enabled?: boolean;
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export function useIncidentWebSocket({
  incidentId,
  onEvent,
  enabled = true,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isUnmountingRef = useRef(false);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close(1000, "Intentional disconnect");
      wsRef.current = null;
    }
    setStatus("disconnected");
  }, []);

  const connect = useCallback(() => {
    if (!incidentId || !enabled || isUnmountingRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus("connecting");

    try {
      const ws = createWebSocket(incidentId);
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        setStatus("connected");
        reconnectAttemptsRef.current = 0;

        // Send ping every 30s to keep alive
        const pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          } else {
            clearInterval(pingInterval);
          }
        }, 30000);

        ws.addEventListener("close", () => clearInterval(pingInterval));
      });

      ws.addEventListener("message", (event) => {
        try {
          const data = JSON.parse(event.data as string) as WorkflowEvent;
          if (data.type !== ("pong" as WorkflowEvent["type"])) {
            onEvent(data);
          }
        } catch {
          // Ignore malformed messages
        }
      });

      ws.addEventListener("error", () => {
        setStatus("error");
      });

      ws.addEventListener("close", (event) => {
        wsRef.current = null;
        if (isUnmountingRef.current) return;

        // Reconnect with exponential backoff
        if (event.code !== 1000 && reconnectAttemptsRef.current < 10) {
          setStatus("connecting");
          const delay = Math.min(
            1000 * Math.pow(2, reconnectAttemptsRef.current),
            30000
          );
          reconnectAttemptsRef.current++;
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        } else {
          setStatus("disconnected");
        }
      });
    } catch {
      setStatus("error");
    }
  }, [incidentId, enabled, onEvent]);

  useEffect(() => {
    isUnmountingRef.current = false;
    if (incidentId && enabled) {
      connect();
    }

    return () => {
      isUnmountingRef.current = true;
      disconnect();
    };
  }, [incidentId, enabled, connect, disconnect]);

  return { status, disconnect, reconnect: connect };
}
