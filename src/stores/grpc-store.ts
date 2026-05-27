import { create } from "zustand";
import type { GrpcMethod, GrpcResponse } from "@/lib/tauri";
import type { KvRow } from "@/lib/types";

/**
 * Per-tab gRPC editor state for the `"grpc"` connection mode. Keyed by tab id
 * so each tab keeps its own loaded proto, selected method, request body, and
 * last response independently.
 *
 * Not persisted: a loaded proto path + transient response are session-scoped
 * (mirrors how the SSE/WS stream log and the HTTP response body are dropped
 * from the persisted tab snapshot). The endpoint comes from the tab's URL
 * field, so it survives restart via the normal request persistence.
 */
export interface GrpcTabState {
  /** Absolute path to the picked `.proto` file, or null if none loaded. */
  protoPath: string | null;
  /** Methods parsed from the proto (empty until loaded). */
  methods: GrpcMethod[];
  /** `service/method` key of the selected method, or null. */
  selected: string | null;
  /** JSON request body editor text. */
  jsonBody: string;
  /** gRPC metadata (request headers) rows. */
  metadata: KvRow[];
  /** Last call result, or null. */
  response: GrpcResponse | null;
  /** True while a list-methods or call is in flight. */
  loading: boolean;
  /** Hard error (parse/transport), shown as a red banner. null when none. */
  error: string | null;
}

/** Default per-tab gRPC state for an untouched tab. Single source of truth. */
export const EMPTY: GrpcTabState = {
  protoPath: null,
  methods: [],
  selected: null,
  jsonBody: "{}",
  metadata: [],
  response: null,
  loading: false,
  error: null,
};

interface GrpcStore {
  byTab: Record<string, GrpcTabState>;
  /** Read a tab's gRPC state, falling back to the empty default. */
  get: (tabId: string) => GrpcTabState;
  /** Merge a partial patch into a tab's gRPC state. */
  patch: (tabId: string, next: Partial<GrpcTabState>) => void;
  /** Drop all state for a tab — call when a tab is closed. */
  remove: (tabId: string) => void;
}

export const useGrpc = create<GrpcStore>((set, get) => ({
  byTab: {},

  get: (tabId) => get().byTab[tabId] ?? EMPTY,

  patch: (tabId, next) =>
    set((s) => {
      const prev = s.byTab[tabId] ?? EMPTY;
      return { byTab: { ...s.byTab, [tabId]: { ...prev, ...next } } };
    }),

  remove: (tabId) =>
    set((s) => {
      if (!(tabId in s.byTab)) return s;
      const byTab = { ...s.byTab };
      delete byTab[tabId];
      return { byTab };
    }),
}));

/** Build the `service/method` key used to identify a selected method. */
export function methodKey(m: Pick<GrpcMethod, "service" | "method">): string {
  return `${m.service}/${m.method}`;
}
