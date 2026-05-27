import {
  ArrowDownIcon,
  ArrowUpIcon,
  CircleIcon,
  SendHorizontalIcon,
  Trash2Icon,
  WifiIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { StreamMsg } from "@/lib/tauri";
import { wsSend } from "@/lib/tauri";
import { tabMode, useTabs } from "@/stores/request-store";
import { type StreamStatus, useStream } from "@/stores/stream-store";

/** Color + label for each message kind badge. */
const KIND_STYLE: Record<StreamMsg["kind"], { color: string; label: string }> = {
  open: { color: "var(--color-success)", label: "OPEN" },
  message: { color: "var(--color-info)", label: "RECV" },
  sent: { color: "var(--color-primary)", label: "SENT" },
  close: { color: "var(--color-muted-foreground)", label: "CLOSE" },
  error: { color: "var(--color-destructive)", label: "ERROR" },
};

const STATUS_STYLE: Record<StreamStatus, { color: string; label: string }> = {
  idle: { color: "var(--color-muted-foreground)", label: "Disconnected" },
  connecting: { color: "var(--color-warning)", label: "Connecting…" },
  connected: { color: "var(--color-success)", label: "Connected" },
  closed: { color: "var(--color-muted-foreground)", label: "Closed" },
  error: { color: "var(--color-destructive)", label: "Error" },
};

function formatTs(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function MessageRow({ msg }: { msg: StreamMsg }) {
  const style = KIND_STYLE[msg.kind];
  return (
    <div className="flex items-start gap-2 border-border/40 border-b px-3 py-1.5 font-mono text-xs last:border-b-0">
      {msg.kind === "sent" ? (
        <ArrowUpIcon
          className="mt-0.5 size-3 shrink-0"
          style={{ color: style.color }}
          strokeWidth={1.75}
          aria-hidden="true"
        />
      ) : msg.kind === "message" ? (
        <ArrowDownIcon
          className="mt-0.5 size-3 shrink-0"
          style={{ color: style.color }}
          strokeWidth={1.75}
          aria-hidden="true"
        />
      ) : (
        <CircleIcon
          className="mt-0.5 size-3 shrink-0"
          style={{ color: style.color }}
          strokeWidth={1.75}
          aria-hidden="true"
        />
      )}
      <span className="shrink-0 text-muted-foreground/60 nums-tabular">{formatTs(msg.ts)}</span>
      <span
        className="shrink-0 rounded-sm border px-1 py-px font-semibold text-[10px] leading-none"
        style={{
          color: style.color,
          borderColor: `color-mix(in oklch, ${style.color} 35%, transparent)`,
          backgroundColor: `color-mix(in oklch, ${style.color} 10%, transparent)`,
        }}
      >
        {style.label}
      </span>
      {msg.event && (
        <span className="shrink-0 text-muted-foreground/80" title="SSE event name">
          {msg.event}
        </span>
      )}
      <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all text-foreground">{msg.data}</pre>
    </div>
  );
}

export function StreamPanel() {
  const activeTab = useTabs((s) => s.tabs.find((t) => t.id === s.activeId) ?? s.tabs[0]);
  const tabId = activeTab.id;
  const mode = tabMode(activeTab.request);
  const stream = useStream((s) => s.byTab[tabId]);
  const clear = useStream((s) => s.clear);
  const setStreamError = useStream((s) => s.setError);

  const messages = stream?.messages ?? [];
  const status = stream?.status ?? "idle";
  const connectionId = stream?.connectionId ?? null;

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to newest message when the log grows. `messages.length` is a
  // re-run trigger (the body only touches the ref), so it's intentional.
  // biome-ignore lint/correctness/useExhaustiveDependencies: length is the scroll trigger
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function onSend() {
    const text = draft.trim();
    if (!text || !connectionId || status !== "connected") return;
    try {
      await wsSend(connectionId, text);
      setDraft("");
    } catch (e) {
      // Surface the failure instead of dropping it silently. `ws_send` rejects
      // when the socket is gone ("connection closed"/"not found"), so this also
      // reflects the broken state in the status strip rather than looking idle.
      setStreamError(tabId, `Send failed: ${String(e)}`);
    }
  }

  const statusStyle = STATUS_STYLE[status];
  const canSend = mode === "websocket" && status === "connected" && connectionId !== null;

  return (
    <div className="absolute inset-0 flex min-w-0 flex-col">
      {/* Status strip */}
      <div className="flex shrink-0 items-center gap-3 border-border border-b bg-card px-3 py-2 font-mono text-xs">
        <span
          className="inline-flex items-center gap-1.5"
          style={{ color: statusStyle.color }}
          role="status"
          aria-live="polite"
        >
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full ${status === "connected" ? "animate-pulse" : ""}`}
            style={{ backgroundColor: statusStyle.color }}
          />
          {statusStyle.label}
        </span>
        {stream?.error && (
          <span className="truncate text-destructive" title={stream.error} role="alert">
            {stream.error}
          </span>
        )}
        <span className="ml-auto text-muted-foreground/70 nums-tabular">
          {messages.length} {messages.length === 1 ? "message" : "messages"}
        </span>
        <button
          type="button"
          onClick={() => clear(tabId)}
          disabled={messages.length === 0}
          className="flex h-6 cursor-pointer items-center gap-1 rounded-sm border border-border/60 bg-card px-2 text-muted-foreground transition-all duration-150 hover:border-primary/40 hover:text-foreground active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Clear messages"
          title="Clear messages"
        >
          <Trash2Icon className="size-3" strokeWidth={1.75} aria-hidden="true" />
          Clear
        </button>
      </div>

      {/* Message log */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        {messages.length === 0 ? (
          <div className="bg-mesh-primary flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
            <div className="grid size-12 place-items-center rounded-full bg-card shadow-sm ring-1 ring-border">
              <WifiIcon
                className="size-6 text-muted-foreground/50"
                strokeWidth={1.25}
                aria-hidden="true"
              />
            </div>
            <div className="font-display text-xl italic text-muted-foreground">No messages yet</div>
            <p className="max-w-[32ch] text-muted-foreground/80 text-xs leading-relaxed">
              {mode === "websocket"
                ? "Connect to a WebSocket endpoint to start exchanging messages."
                : "Connect to an SSE endpoint to watch the live event stream."}
            </p>
          </div>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only message log, never reordered
          messages.map((m, i) => <MessageRow key={`${m.ts}-${i}`} msg={m} />)
        )}
      </div>

      {/* WebSocket send box */}
      {mode === "websocket" && (
        <div className="flex shrink-0 items-center gap-2 border-border border-t bg-card px-3 py-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void onSend();
              }
            }}
            placeholder={canSend ? "Type a message and press Enter…" : "Connect to send messages"}
            disabled={!canSend}
            className="h-8 cursor-text font-mono text-xs"
            aria-label="WebSocket message to send"
          />
          <Button
            size="sm"
            onClick={() => void onSend()}
            disabled={!canSend || draft.trim().length === 0}
            className="h-8 shrink-0 cursor-pointer gap-1.5 disabled:cursor-not-allowed"
            title="Send message"
          >
            <SendHorizontalIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            Send
          </Button>
        </div>
      )}
    </div>
  );
}
