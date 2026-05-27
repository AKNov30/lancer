import { create } from "zustand";
import type { StreamMsg } from "@/lib/tauri";

/**
 * Per-tab streaming state for SSE / WebSocket connections. Keyed by tab id so
 * each tab keeps its own connection + message log independently, and switching
 * tabs doesn't blur one connection's stream into another's.
 *
 * Not persisted: a live socket can't survive an app restart, so the message
 * log is session-scoped (mirrors how the HTTP response body is dropped from
 * the persisted tab snapshot).
 */
export type StreamStatus = "idle" | "connecting" | "connected" | "closed" | "error";

export interface StreamState {
  status: StreamStatus;
  /** Backend connection id, set once connected; cleared on disconnect. */
  connectionId: string | null;
  /** Received + sent messages, oldest first (newest appended). */
  messages: StreamMsg[];
  /** Last error detail, for surfacing in the panel header. */
  error: string | null;
}

/** Cap the in-memory log so a chatty stream can't grow it without bound. */
const MAX_MESSAGES = 2000;

const EMPTY: StreamState = {
  status: "idle",
  connectionId: null,
  messages: [],
  error: null,
};

interface StreamStore {
  /** Per-tab stream state. Absent key → treat as {@link EMPTY}. */
  byTab: Record<string, StreamState>;

  /** Read a tab's stream state, falling back to the empty default. */
  get: (tabId: string) => StreamState;
  /** Mark a tab as connecting (clears any prior log + error). */
  beginConnect: (tabId: string) => void;
  /** Record a successful connect with its backend connection id. */
  setConnected: (tabId: string, connectionId: string) => void;
  /** Append a streamed message; advances status from open/close/error. */
  pushMessage: (tabId: string, msg: StreamMsg) => void;
  /** Mark connection closed (keeps the message log). */
  markClosed: (tabId: string) => void;
  /** Record a connect failure. */
  setError: (tabId: string, error: string) => void;
  /** Clear the message log for a tab (keeps connection status). */
  clear: (tabId: string) => void;
  /** Drop all state for a tab — call when a tab is closed. */
  remove: (tabId: string) => void;
}

function patch(
  store: { byTab: Record<string, StreamState> },
  tabId: string,
  next: Partial<StreamState>,
): { byTab: Record<string, StreamState> } {
  const prev = store.byTab[tabId] ?? EMPTY;
  return { byTab: { ...store.byTab, [tabId]: { ...prev, ...next } } };
}

export const useStream = create<StreamStore>((set, get) => ({
  byTab: {},

  get: (tabId) => get().byTab[tabId] ?? EMPTY,

  beginConnect: (tabId) =>
    set((s) =>
      patch(s, tabId, { status: "connecting", connectionId: null, messages: [], error: null }),
    ),

  setConnected: (tabId, connectionId) =>
    set((s) => patch(s, tabId, { status: "connected", connectionId })),

  pushMessage: (tabId, msg) =>
    set((s) => {
      const prev = s.byTab[tabId] ?? EMPTY;
      const messages = [...prev.messages, msg];
      // Trim from the front when over the cap.
      if (messages.length > MAX_MESSAGES) messages.splice(0, messages.length - MAX_MESSAGES);
      let status = prev.status;
      let error = prev.error;
      if (msg.kind === "open") status = "connected";
      else if (msg.kind === "close") status = "closed";
      else if (msg.kind === "error") {
        status = "error";
        error = msg.data;
      }
      return { byTab: { ...s.byTab, [tabId]: { ...prev, messages, status, error } } };
    }),

  markClosed: (tabId) => set((s) => patch(s, tabId, { status: "closed", connectionId: null })),

  setError: (tabId, error) =>
    set((s) => patch(s, tabId, { status: "error", error, connectionId: null })),

  clear: (tabId) => set((s) => patch(s, tabId, { messages: [] })),

  remove: (tabId) =>
    set((s) => {
      if (!(tabId in s.byTab)) return s;
      const byTab = { ...s.byTab };
      delete byTab[tabId];
      return { byTab };
    }),
}));
