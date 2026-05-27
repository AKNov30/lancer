import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { disconnect } from "@/lib/tauri";
import {
  type Auth,
  type Body,
  bodyToWire,
  type ConnectionMode,
  type HttpRequest,
  type HttpResponse,
  type KvRow,
  kvRowsToTuples,
  type Method,
  type RequestOptions,
} from "@/lib/types";
import { useGrpc } from "@/stores/grpc-store";
import { useStream } from "@/stores/stream-store";

/**
 * In-store request shape — uses {@link KvRow}[] so disabled rows persist
 * in the editor state. Converted to tuple-form {@link HttpRequest} at
 * send time via {@link toWireRequest}.
 */
export interface RequestForm {
  url: string;
  method: Method;
  /**
   * Connection mode. `"http"` (default) is the classic request/response flow;
   * `"sse"` / `"websocket"` open a streaming connection. Optional in the type
   * so older persisted tabs hydrate cleanly — read it via {@link tabMode}.
   */
  mode?: ConnectionMode;
  headers: KvRow[];
  query: KvRow[];
  body: Body;
  options: RequestOptions;
  /**
   * Per-request variables — Bruno-format `vars { ... }` block. These layer
   * above env file vars and below the runtime overlay during substitution,
   * giving each request its own defaults without polluting the global env.
   */
  vars: KvRow[];
  /**
   * Post-response captures: JSONPath expressions to extract from the response
   * body, written into the runtime env overlay so chained requests can use
   * `{{token}}` style placeholders. Session-scoped — not persisted to `.bru`.
   */
  captures: Capture[];
  /**
   * User JavaScript run BEFORE the request is sent — may set vars/headers via
   * `lancer.env.set(...)`. Persisted to `.bru` as a `script:pre-request` block.
   * Optional so older persisted tabs hydrate cleanly.
   */
  preRequestScript?: string;
  /**
   * User JavaScript run AFTER the response arrives — may assert on the response
   * via `lancer.test(...)`. Persisted to `.bru` as `script:post-response`.
   */
  postResponseScript?: string;
}

export interface Capture {
  /** Stable id so React key reconciliation doesn't reorder rows on edit. */
  id: string;
  enabled: boolean;
  jsonpath: string;
  envVar: string;
}

const DEFAULT_OPTIONS: RequestOptions = {
  timeoutMs: null,
  followRedirects: null,
  maxRedirects: null,
  insecureSkipVerify: null,
};

/**
 * One open tab in the editor. Each tab carries its own request, auth,
 * response, and loading/error UI state. `savedPath` is the on-disk `.bru`
 * file this tab corresponds to (null = scratch tab not yet saved).
 *
 * `suggestedSaveDir` lets a "New request here" action from the sidebar
 * pre-aim the Save-As file dialog at the chosen folder, without forcing
 * the user to pick a filename upfront.
 */
export interface Tab {
  id: string;
  name: string;
  savedPath: string | null;
  suggestedSaveDir: string | null;
  dirty: boolean;
  request: RequestForm;
  auth: Auth;
  response: HttpResponse | null;
  loading: boolean;
  error: string | null;
}

function emptyTab(name = "Untitled", suggestedSaveDir: string | null = null): Tab {
  return {
    id: crypto.randomUUID(),
    name,
    savedPath: null,
    suggestedSaveDir,
    dirty: false,
    request: {
      url: "",
      method: "GET",
      mode: "http",
      headers: [],
      query: [],
      body: { kind: "none" },
      options: { ...DEFAULT_OPTIONS },
      vars: [],
      captures: [],
      preRequestScript: "",
      postResponseScript: "",
    },
    auth: { kind: "none" },
    response: null,
    loading: false,
    error: null,
  };
}

interface TabsState {
  tabs: Tab[];
  activeId: string;

  // ─── Tab management ─────────────────────────────────────────────────
  /** Open a new scratch tab. Optionally aim its first Save dialog at a folder. */
  newTab: (opts?: { name?: string; suggestedSaveDir?: string | null }) => string;
  /** Open or focus a tab for the given .bru file path (one tab per path). */
  openInTab: (path: string, name: string, hydrate: (t: Tab) => Tab) => string;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  renameTab: (id: string, name: string) => void;
  reorderTabs: (fromIdx: number, toIdx: number) => void;
  /** Mark a tab as saved (clean) and update its file path. */
  markTabSaved: (id: string, path: string, name?: string) => void;
  /** After a file move on disk, retarget any tab pointing at the old path. */
  retargetSavedPath: (oldPath: string, newPath: string) => void;

  // ─── Active-tab data setters (always target activeId) ───────────────
  setUrl: (url: string) => void;
  setMethod: (method: Method) => void;
  setMode: (mode: ConnectionMode) => void;
  setHeaders: (headers: KvRow[]) => void;
  setQuery: (query: KvRow[]) => void;
  setBody: (body: Body) => void;
  setOptions: (options: RequestOptions) => void;
  setVars: (vars: KvRow[]) => void;
  setCaptures: (captures: Capture[]) => void;
  setPreRequestScript: (code: string) => void;
  setPostResponseScript: (code: string) => void;
  setAuth: (auth: Auth) => void;
  setResponse: (resp: HttpResponse | null) => void;
  setLoading: (b: boolean) => void;
  setError: (e: string | null) => void;
}

const FIRST_TAB = emptyTab("New request");

/**
 * Tabs persist across app restarts. Response bodies + transient UI state
 * (loading/error) are stripped from the saved snapshot so localStorage stays
 * small and we don't try to restore a hanging "Sending…" indicator. Tabs
 * are otherwise restored exactly — including unsaved scratch edits, which
 * is the part Postman gets wrong (loses everything on restart).
 */
const STORAGE_KEY = "lancer.tabs.v1";

export const useTabs = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [FIRST_TAB],
      activeId: FIRST_TAB.id,

      newTab: (opts) => {
        const t = emptyTab(
          opts?.name ?? `Request ${get().tabs.length + 1}`,
          opts?.suggestedSaveDir ?? null,
        );
        set((s) => ({ tabs: [...s.tabs, t], activeId: t.id }));
        return t.id;
      },

      openInTab: (path, name, hydrate) => {
        const existing = get().tabs.find((t) => t.savedPath === path);
        if (existing) {
          set({ activeId: existing.id });
          // Preserve unsaved edits: only reload a CLEAN tab from disk. A dirty
          // tab keeps its in-memory edits (Postman behavior) — clicking the
          // sidebar row just focuses it, and the dirty dot stays until the user
          // saves or reverts. This matches the app-shell external-change watcher,
          // which already skips dirty tabs.
          if (!existing.dirty) {
            set((s) => ({
              tabs: s.tabs.map((t) => (t.id === existing.id ? hydrate({ ...t, dirty: false }) : t)),
            }));
          }
          return existing.id;
        }
        const base = emptyTab(name);
        const t = hydrate({ ...base, savedPath: path, name });
        set((s) => ({ tabs: [...s.tabs, t], activeId: t.id }));
        return t.id;
      },

      closeTab: (id) => {
        // Tear down any live SSE/WebSocket connection this tab owns so the
        // backend task stops and the registry doesn't leak. Best-effort —
        // the connection may already be closed.
        const streamState = useStream.getState();
        const stream = streamState.byTab[id];
        if (stream?.connectionId) void disconnect(stream.connectionId);
        streamState.remove(id);
        // Drop any gRPC editor state this tab owned (loaded proto, response).
        useGrpc.getState().remove(id);

        set((s) => {
          const idx = s.tabs.findIndex((t) => t.id === id);
          if (idx === -1) return s;
          const tabs = s.tabs.filter((t) => t.id !== id);
          // Always keep at least one tab open.
          if (tabs.length === 0) {
            const replacement = emptyTab("New request");
            return { tabs: [replacement], activeId: replacement.id };
          }
          // If we closed the active tab, focus the neighbor (prev if available).
          let activeId = s.activeId;
          if (s.activeId === id) {
            activeId = tabs[Math.max(0, idx - 1)]?.id ?? tabs[0].id;
          }
          return { tabs, activeId };
        });
      },

      setActive: (id) => set({ activeId: id }),

      renameTab: (id, name) =>
        set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, name } : t)) })),

      reorderTabs: (fromIdx, toIdx) =>
        set((s) => {
          const tabs = [...s.tabs];
          const [moved] = tabs.splice(fromIdx, 1);
          tabs.splice(toIdx, 0, moved);
          return { tabs };
        }),

      markTabSaved: (id, path, name) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === id ? { ...t, savedPath: path, dirty: false, name: name ?? t.name } : t,
          ),
        })),

      // Retarget open tabs after a file/folder is renamed or moved on disk.
      // Handles BOTH an exact file match AND descendants of a renamed folder
      // (e.g. renaming `users/` must fix a tab at `users/me.bru`), so the
      // next save writes to the new path instead of the deleted one.
      retargetSavedPath: (oldPath, newPath) =>
        set((s) => {
          const sep = oldPath.includes("\\") ? "\\" : "/";
          const oldPrefix = oldPath + sep;
          const newPrefix = newPath + sep;
          // For an exact file match (the renamed file itself), also refresh the
          // tab title to the new filename stem — the sidebar shows `meta.name`
          // which now tracks the filename, so the open tab should match too.
          // Otherwise a renamed-but-open file keeps its stale tab title.
          const newLeaf = newPath.slice(newPath.lastIndexOf(sep) + 1).replace(/\.bru$/i, "");
          return {
            tabs: s.tabs.map((t) => {
              if (!t.savedPath) return t;
              if (t.savedPath === oldPath) {
                return { ...t, savedPath: newPath, name: newLeaf || t.name };
              }
              if (t.savedPath.startsWith(oldPrefix)) {
                return { ...t, savedPath: newPrefix + t.savedPath.slice(oldPrefix.length) };
              }
              return t;
            }),
          };
        }),

      setUrl: (url) =>
        set((s) => mutateActive(s, (t) => ({ ...t, dirty: true, request: { ...t.request, url } }))),
      setMethod: (method) =>
        set((s) =>
          mutateActive(s, (t) => ({ ...t, dirty: true, request: { ...t.request, method } })),
        ),
      setMode: (mode) => {
        // Tear down a live SSE/WebSocket connection when the active tab leaves a
        // streaming mode. Otherwise the backend task keeps the socket open and
        // the registry leaks the connection. Mirrors closeTab's teardown.
        const active = getActive(get());
        const prevMode = tabMode(active.request);
        const wasStreaming = prevMode === "sse" || prevMode === "websocket";
        if (wasStreaming && mode !== prevMode) {
          const streamState = useStream.getState();
          const stream = streamState.byTab[active.id];
          if (stream?.connectionId) {
            void disconnect(stream.connectionId);
            streamState.markClosed(active.id);
          }
        }
        set((s) =>
          mutateActive(s, (t) => ({ ...t, dirty: true, request: { ...t.request, mode } })),
        );
      },
      setHeaders: (headers) =>
        set((s) =>
          mutateActive(s, (t) => ({ ...t, dirty: true, request: { ...t.request, headers } })),
        ),
      setQuery: (query) =>
        set((s) =>
          mutateActive(s, (t) => ({ ...t, dirty: true, request: { ...t.request, query } })),
        ),
      setBody: (body) =>
        set((s) =>
          mutateActive(s, (t) => ({ ...t, dirty: true, request: { ...t.request, body } })),
        ),
      setOptions: (options) =>
        set((s) =>
          mutateActive(s, (t) => ({ ...t, dirty: true, request: { ...t.request, options } })),
        ),
      setVars: (vars) =>
        set((s) =>
          mutateActive(s, (t) => ({ ...t, dirty: true, request: { ...t.request, vars } })),
        ),
      setCaptures: (captures) =>
        set((s) =>
          mutateActive(s, (t) => ({ ...t, dirty: true, request: { ...t.request, captures } })),
        ),
      setPreRequestScript: (preRequestScript) =>
        set((s) =>
          mutateActive(s, (t) => ({
            ...t,
            dirty: true,
            request: { ...t.request, preRequestScript },
          })),
        ),
      setPostResponseScript: (postResponseScript) =>
        set((s) =>
          mutateActive(s, (t) => ({
            ...t,
            dirty: true,
            request: { ...t.request, postResponseScript },
          })),
        ),
      setAuth: (auth) => set((s) => mutateActive(s, (t) => ({ ...t, dirty: true, auth }))),
      setResponse: (response) => set((s) => mutateActive(s, (t) => ({ ...t, response }))),
      setLoading: (loading) => set((s) => mutateActive(s, (t) => ({ ...t, loading }))),
      setError: (error) => set((s) => mutateActive(s, (t) => ({ ...t, error }))),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => window.localStorage),
      version: 2,
      // v1 → v2: tabs predate the `mode` discriminator. Backfill `"http"` so
      // restored tabs behave exactly as before (and aren't `undefined`).
      // Defensive about shape since this runs over raw localStorage JSON.
      migrate: (persisted, version) => {
        const state = persisted as Partial<TabsState> | undefined;
        if (!state || !Array.isArray(state.tabs)) return state as TabsState;
        if (version < 2) {
          state.tabs = state.tabs.map((t) => ({
            ...t,
            request: { ...t.request, mode: t.request?.mode ?? "http" },
          }));
        }
        return state as TabsState;
      },
      // Strip transient fields before persisting. Response bodies can be MB
      // each (binary downloads); we don't want to fill localStorage with
      // them and we don't want a "Sending…" spinner restored after a crash.
      partialize: (s) => ({
        tabs: s.tabs.map((t) => ({
          ...t,
          response: null,
          loading: false,
          error: null,
        })),
        activeId: s.activeId,
      }),
    },
  ),
);

function mutateActive(state: TabsState, updater: (t: Tab) => Tab): Partial<TabsState> {
  const tabs = state.tabs.map((t) => (t.id === state.activeId ? updater(t) : t));
  return { tabs };
}

function getActive(state: TabsState): Tab {
  return state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0];
}

/**
 * Backward-compatible facade — exposes the ACTIVE tab's slice plus the
 * existing setter API. Components that previously used `useRequest((s) => s.request.url)`
 * keep working unchanged; the selector now silently targets the active tab.
 */
export interface ActiveTabSlice {
  request: RequestForm;
  auth: Auth;
  response: HttpResponse | null;
  loading: boolean;
  error: string | null;
  setUrl: TabsState["setUrl"];
  setMethod: TabsState["setMethod"];
  setMode: TabsState["setMode"];
  setHeaders: TabsState["setHeaders"];
  setQuery: TabsState["setQuery"];
  setBody: TabsState["setBody"];
  setOptions: TabsState["setOptions"];
  setVars: TabsState["setVars"];
  setCaptures: TabsState["setCaptures"];
  setPreRequestScript: TabsState["setPreRequestScript"];
  setPostResponseScript: TabsState["setPostResponseScript"];
  setAuth: TabsState["setAuth"];
  setResponse: TabsState["setResponse"];
  setLoading: TabsState["setLoading"];
  setError: TabsState["setError"];
}

function buildActiveSlice(s: TabsState): ActiveTabSlice {
  const active = getActive(s);
  return {
    request: active.request,
    auth: active.auth,
    response: active.response,
    loading: active.loading,
    error: active.error,
    setUrl: s.setUrl,
    setMethod: s.setMethod,
    setMode: s.setMode,
    setHeaders: s.setHeaders,
    setQuery: s.setQuery,
    setBody: s.setBody,
    setOptions: s.setOptions,
    setVars: s.setVars,
    setCaptures: s.setCaptures,
    setPreRequestScript: s.setPreRequestScript,
    setPostResponseScript: s.setPostResponseScript,
    setAuth: s.setAuth,
    setResponse: s.setResponse,
    setLoading: s.setLoading,
    setError: s.setError,
  };
}

function useRequestImpl<T>(selector: (s: ActiveTabSlice) => T): T {
  return useTabs((s) => selector(buildActiveSlice(s)));
}

/**
 * Vanilla read of the active tab's slice — for tests and non-React code.
 * Mirrors Zustand's `store.getState()` ergonomics.
 */
useRequestImpl.getState = (): ActiveTabSlice => buildActiveSlice(useTabs.getState());

type ActiveDataPatch = Partial<
  Pick<ActiveTabSlice, "request" | "auth" | "response" | "loading" | "error">
>;

/**
 * Patch the active tab's data — for tests. Accepts a partial object OR
 * an updater function that receives the current active slice and returns
 * a partial. Mirrors Zustand's `setState` ergonomics.
 */
useRequestImpl.setState = (
  patchOrUpdater: ActiveDataPatch | ((prev: ActiveTabSlice) => ActiveDataPatch),
): void => {
  useTabs.setState((s) => {
    const patch =
      typeof patchOrUpdater === "function" ? patchOrUpdater(buildActiveSlice(s)) : patchOrUpdater;
    return { tabs: s.tabs.map((t) => (t.id === s.activeId ? { ...t, ...patch } : t)) };
  });
};

export const useRequest = useRequestImpl;

/**
 * Convert the editable {@link RequestForm} into a wire-format
 * {@link HttpRequest} accepted by the Rust `send_request` command.
 *
 * Returns `null` if the body cannot be converted (e.g. multipart, which the
 * wire layer doesn't accept yet). The caller should surface a friendly
 * error in that case rather than silently dropping the body.
 */
/** Read a request's connection mode, defaulting to `"http"` when absent. */
export function tabMode(form: Pick<RequestForm, "mode">): ConnectionMode {
  return form.mode ?? "http";
}

export function toWireRequest(form: RequestForm): HttpRequest | null {
  const wireBody = bodyToWire(form.body);
  if (wireBody === undefined) return null;
  // Only include non-null option fields so the wire payload stays compact.
  const opts: RequestOptions = {};
  if (form.options.timeoutMs != null) opts.timeoutMs = form.options.timeoutMs;
  if (form.options.followRedirects != null) opts.followRedirects = form.options.followRedirects;
  if (form.options.maxRedirects != null) opts.maxRedirects = form.options.maxRedirects;
  if (form.options.insecureSkipVerify != null) {
    opts.insecureSkipVerify = form.options.insecureSkipVerify;
  }
  const hasOpts = Object.keys(opts).length > 0;
  return {
    url: form.url,
    method: form.method,
    headers: kvRowsToTuples(form.headers),
    query: kvRowsToTuples(form.query),
    body: wireBody.kind === "none" ? undefined : wireBody,
    options: hasOpts ? opts : null,
  };
}
