// IncidentPilot — Chat Panel

import React, { useState, useRef, useEffect } from "react";
import { clsx } from "clsx";
import type { ChatMessage } from "../types/index.js";
import { sendChatMessage } from "../lib/api.js";
import { Spinner } from "./ui.js";

interface ChatPanelProps {
  incidentId: string;
  messages: ChatMessage[];
  onMessage: (msg: ChatMessage) => void;
  disabled?: boolean;
}

export function ChatPanel({ incidentId, messages, onMessage, disabled }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || sending || disabled) return;

    setInput("");
    setError(null);

    // Optimistic user message
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: msg,
      timestamp: new Date().toISOString(),
      incidentId,
    };
    onMessage(userMsg);
    setSending(true);

    try {
      const res = await sendChatMessage(incidentId, msg);
      if (res.success && res.message) {
        onMessage({
          id: res.message.id,
          role: "assistant",
          content: res.message.content,
          timestamp: res.message.timestamp,
          incidentId,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const visibleMessages = messages.filter(
    (m) => m.role === "user" || m.role === "assistant"
  );

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 p-4 min-h-0">
        {visibleMessages.length === 0 && (
          <div className="text-center py-8 space-y-2">
            <div className="text-2xl">🤖</div>
            <p className="text-xs text-text-muted">
              Ask me to investigate, explain evidence, or generate a report.
            </p>
            <div className="space-y-1 pt-2">
              {[
                "Investigate the increased latency",
                "Show me the evidence for your root cause",
                "What changed before the incident?",
                "Generate an incident report",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInput(suggestion);
                    inputRef.current?.focus();
                  }}
                  className="block w-full text-left text-xs text-text-muted bg-bg-secondary border border-border rounded px-2 py-1.5 hover:bg-bg-hover hover:text-text-secondary transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {visibleMessages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {sending && (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Spinner size="sm" />
            <span>Investigating…</span>
          </div>
        )}

        {error && (
          <div className="text-xs text-severity-critical bg-severity-critical/10 border border-severity-critical/20 rounded p-2">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border p-3">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            className="input flex-1 text-sm"
            placeholder={disabled ? "Start an investigation first…" : "Ask about this incident…"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled || sending}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || disabled || sending}
            className="btn-primary px-4"
          >
            {sending ? <Spinner size="sm" /> : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={clsx("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={clsx(
          "max-w-[90%] rounded-lg px-3 py-2 text-sm",
          isUser
            ? "bg-brand/10 border border-brand/20 text-text-primary"
            : "bg-bg-secondary border border-border text-text-secondary"
        )}
      >
        {!isUser && (
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="w-4 h-4 rounded-full bg-brand/20 flex items-center justify-center">
              <span className="text-xs">🤖</span>
            </span>
            <span className="text-xs text-text-muted font-medium">IncidentPilot Agent</span>
          </div>
        )}
        <FormattedMessage content={message.content} />
        <div className="text-xs text-text-muted mt-1 text-right">
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}

function FormattedMessage({ content }: { content: string }) {
  // Very simple markdown-lite rendering: bold, code, line breaks
  const lines = content.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (line.startsWith("```") || line.startsWith("   ")) {
          return (
            <code key={i} className="block font-mono text-xs bg-bg-tertiary rounded px-2 py-0.5 text-text-secondary">
              {line.replace(/^```\w*/, "").replace(/```$/, "")}
            </code>
          );
        }
        if (line.startsWith("**") && line.endsWith("**")) {
          return <p key={i} className="font-semibold text-text-primary">{line.slice(2, -2)}</p>;
        }
        if (line === "") return <br key={i} />;
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}
