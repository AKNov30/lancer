import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  CheckIcon,
  Loader2,
  PlugIcon,
  PlugZapIcon,
  SaveIcon,
  SendHorizontalIcon,
  TerminalIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { runCaptures } from "@/lib/captures";
import { toCollectionRequest } from "@/lib/collection-convert";
import {
  CANCELLED_SENTINEL,
  cancelRequest,
  disconnect,
  parseCurl,
  resolveVars,
  sendRequest,
  sseConnect,
  writeRequest,
  wsConnect,
} from "@/lib/tauri";
import { isMethod, kvRowsToTuples, tuplesToKvRows, wireBodyToEditor } from "@/lib/types";
import { useCaptures } from "@/stores/captures-store";
import { useEnv } from "@/stores/env-store";
import { tabMode, toWireRequest, useRequest, useTabs } from "@/stores/request-store";
import { useStream } from "@/stores/stream-store";
import { useWorkspace } from "@/stores/workspace-store";
import { CopyAsMenu } from "./copy-as-menu";
import { MethodSelect } from "./method-select";
import { ModeSelect } from "./mode-select";
import { UrlEditor, type UrlEditorHandle } from "./url-editor";
import { VarResolvedPreview } from "./var-resolved-preview";

const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const SEND_HINT = isMac ? "⌘↵" : "Ctrl+↵";

const CURL_PREFIX = /^\s*curl[\s\\]/i;

/**
 * Resolve a single template string (e.g. `{{baseUrl}}/x`) against the active
 * variable context. Returns the input unchanged on a miss so a resolve gap
 * never blocks a connect — the raw string is used, matching the worst case
 * before substitution existed. Mirrors the gRPC editor's `applyVars`.
 */
function applyVars(text: string, resolved: Map<string, string>): string {
  return text.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (whole, name: string) =>
    resolved.has(name) ? (resolved.get(name) as string) : whole,
  );
}

export function UrlBar() {
  const request = useRequest((s) => s.request);
  const auth = useRequest((s) => s.auth);
  const loading = useRequest((s) => s.loading);
  const setUrl = useRequest((s) => s.setUrl);
  const setMethod = useRequest((s) => s.setMethod);
  const setMode = useRequest((s) => s.setMode);
  const setHeaders = useRequest((s) => s.setHeaders);
  const setQuery = useRequest((s) => s.setQuery);
  const setBody = useRequest((s) => s.setBody);
  const setResponse = useRequest((s) => s.setResponse);
  const setLoading = useRequest((s) => s.setLoading);
  const setError = useRequest((s) => s.setError);
  const workspaceRoot = useWorkspace((s) => s.rootPath);
  const refreshWorkspace = useWorkspace((s) => s.refresh);
  const activeEnv = useEnv((s) => s.activeEnv);
  const activeTab = useTabs((s) => s.tabs.find((t) => t.id === s.activeId) ?? s.tabs[0]);
  const markTabSaved = useTabs((s) => s.markTabSaved);
  const getOverlayForEnv = useCaptures((s) => s.getForEnv);
  const setCapturedMany = useCaptures((s) => s.setMany);
  // Subscribe to the active env's overlay BAG (not just the stable getForEnv
  // ref) so the {{ autocomplete + resolved preview re-run when a capture writes
  // a new token. `getForEnv` alone never changes identity, so the debounced
  // resolveVars effect below would otherwise miss fresh captures.
  const overlayBag = useCaptures((s) => s.overlay[activeEnv ?? "__none__"]);

  // ── Streaming (SSE / WebSocket) ──────────────────────────────────────────
  const mode = tabMode(request);
  const tabId = activeTab.id;
  const streamStatus = useStream((s) => s.byTab[tabId]?.status ?? "idle");
  const streamConnectionId = useStream((s) => s.byTab[tabId]?.connectionId ?? null);
  const beginConnect = useStream((s) => s.beginConnect);
  const setConnected = useStream((s) => s.setConnected);
  const pushMessage = useStream((s) => s.pushMessage);
  const setStreamError = useStream((s) => s.setError);
  const markClosed = useStream((s) => s.markClosed);
  // gRPC is neither classic HTTP nor SSE/WS streaming. The URL field holds the
  // endpoint; the Call action + body live in the GrpcEditor surface, so the
  // url-bar shows no Send/Connect button for it. `isStreaming` here means
  // "SSE/WebSocket" specifically — gRPC is excluded.
  const isGrpc = mode === "grpc";
  const isStreaming = mode === "sse" || mode === "websocket";
  const isConnected = streamStatus === "connected" || streamStatus === "connecting";

  const [savingState, setSavingState] = useState<"idle" | "saving" | "saved">("idle");

  /**
   * Id of the in-flight HTTP request, generated per-send so the user can
   * cancel it via the backend `cancel_request` command. `null` when no request
   * is in flight. A ref (not state) because cancelling reads the latest id
   * without needing a re-render.
   */
  const inFlightRequestId = useRef<string | null>(null);
  /** Brief neutral notice shown after the user cancels a request. */
  const [cancelled, setCancelled] = useState(false);

  /** Holds the pasted cURL text waiting for the user to confirm parse. */
  const [pendingCurl, setPendingCurl] = useState<string | null>(null);
  const [parsingCurl, setParsingCurl] = useState(false);

  /** Ref to the URL editor so Ctrl/Cmd+L can focus + select it. */
  const urlInputRef = useRef<UrlEditorHandle | null>(null);

  /**
   * Active variable NAMES for `{{` autocomplete in the URL editor. Resolved
   * (debounced) via the same Rust call as VarResolvedPreview / send so the
   * folder.bru chain + env file + request.vars + runtime overlay are all
   * reflected. Refetches on env / saved-path / request.vars change.
   */
  const [varNames, setVarNames] = useState<string[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: overlayBag is a re-run trigger (its content, read via getOverlayForEnv, isn't otherwise reactive)
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      const extraVars = [...kvRowsToTuples(request.vars), ...getOverlayForEnv(activeEnv)];
      void resolveVars({
        workspaceRoot: workspaceRoot ?? undefined,
        envName: activeEnv,
        requestPath: activeTab.savedPath ?? undefined,
        extraVars: extraVars.length > 0 ? extraVars : undefined,
      })
        .then((list) => {
          if (!cancelled) setVarNames(list.map((v) => v.name));
        })
        .catch(() => {
          if (!cancelled) setVarNames([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // `overlayBag` is in the deps so a fresh capture re-runs the resolve and the
    // {{ autocomplete picks up newly-captured tokens.
  }, [request.vars, workspaceRoot, activeEnv, activeTab.savedPath, getOverlayForEnv, overlayBag]);

  const onSend = useCallback(async () => {
    if (!request.url || loading) return;
    const wire = toWireRequest(request);
    if (wire === null) {
      // Body kind cannot be sent yet (e.g. multipart wire support pending).
      setError(
        "Multipart bodies can't be sent over the wire yet — coming in the next release. Use Form (URL-encoded) for text fields.",
      );
      return;
    }
    setError(null);
    setCancelled(false);
    setLoading(true);
    // Generate a fresh id so this request can be aborted mid-flight. Stored on
    // a ref so the Cancel button reads the current id without a re-render.
    const requestId = crypto.randomUUID();
    inFlightRequestId.current = requestId;
    try {
      // Snapshot the runtime overlay vars for the active env right before
      // sending so captures from earlier requests in the same session are
      // available as `{{name}}` here.
      // Variable precedence (low → high, last write wins in Rust):
      //   folder.bru chain < env file < request.vars < runtime overlay
      const overlayVars = getOverlayForEnv(activeEnv);
      const extraVars = [...kvRowsToTuples(request.vars), ...overlayVars];
      const resp = await sendRequest(wire, auth, {
        workspaceRoot: workspaceRoot ?? undefined,
        envName: activeEnv,
        requestPath: activeTab.savedPath ?? undefined,
        extraVars: extraVars.length > 0 ? extraVars : undefined,
        preRequestScript: request.preRequestScript || undefined,
        postResponseScript: request.postResponseScript || undefined,
        requestId,
      });
      setResponse(resp);

      // Apply post-response captures. Failures don't surface to the user —
      // the request itself already succeeded; capture problems are silent.
      const captured = runCaptures(request.captures, resp.bodyText);
      if (captured.length > 0) {
        setCapturedMany(activeEnv, captured);
      }
    } catch (e) {
      // The backend returns the cancel sentinel when the user aborted the
      // request — surface that as a NEUTRAL notice, not a red error.
      if (String(e).includes(CANCELLED_SENTINEL)) {
        setCancelled(true);
        setResponse(null);
      } else {
        setError(String(e));
        setResponse(null);
      }
    } finally {
      inFlightRequestId.current = null;
      setLoading(false);
    }
  }, [
    request,
    auth,
    loading,
    workspaceRoot,
    activeEnv,
    activeTab.savedPath,
    setError,
    setLoading,
    setResponse,
    getOverlayForEnv,
    setCapturedMany,
  ]);

  /**
   * Abort the in-flight HTTP request. Best-effort: the backend no-ops if the
   * request already finished. The awaited `sendRequest` in `onSend` then
   * rejects with the cancel sentinel, which clears `loading` and shows the
   * neutral "Request cancelled" notice.
   */
  const onCancel = useCallback(async () => {
    const id = inFlightRequestId.current;
    if (!id) return;
    try {
      await cancelRequest(id);
    } catch {
      /* request may already be gone — onSend's catch handles the outcome */
    }
  }, []);

  /**
   * Open a streaming connection (SSE or WebSocket) for the active tab. Headers
   * from the request editor are forwarded; method/body are irrelevant here.
   * The message log + status live in the per-tab stream store, fed by the
   * Tauri channel callback.
   */
  const onConnect = useCallback(async () => {
    if (!request.url || isConnected) return;
    beginConnect(tabId);
    try {
      // Resolve `{{var}}` templates before connecting so SSE/WS match HTTP —
      // the URL and each header value get substituted. Same env/overlay layering
      // and Rust `resolve_vars` call the send + preview paths use.
      const extraVars = [...kvRowsToTuples(request.vars), ...getOverlayForEnv(activeEnv)];
      const resolvedList = await resolveVars({
        workspaceRoot: workspaceRoot ?? undefined,
        envName: activeEnv,
        requestPath: activeTab.savedPath ?? undefined,
        extraVars: extraVars.length > 0 ? extraVars : undefined,
      });
      const resolved = new Map(resolvedList.map((v) => [v.name, v.value]));
      const resolvedUrl = applyVars(request.url, resolved);
      const headers = kvRowsToTuples(request.headers).map(
        ([k, v]) => [k, applyVars(v, resolved)] as [string, string],
      );
      const onEvent = (msg: Parameters<typeof pushMessage>[1]) => pushMessage(tabId, msg);
      const connId =
        mode === "sse"
          ? await sseConnect(resolvedUrl, headers, onEvent)
          : await wsConnect(resolvedUrl, headers, onEvent);
      setConnected(tabId, connId);
    } catch (e) {
      setStreamError(tabId, String(e));
    }
  }, [
    request.url,
    request.headers,
    request.vars,
    mode,
    tabId,
    isConnected,
    workspaceRoot,
    activeEnv,
    activeTab.savedPath,
    getOverlayForEnv,
    beginConnect,
    pushMessage,
    setConnected,
    setStreamError,
  ]);

  /** Close the active tab's streaming connection. */
  const onDisconnect = useCallback(async () => {
    if (streamConnectionId) {
      try {
        await disconnect(streamConnectionId);
      } catch {
        /* connection may already be gone */
      }
    }
    markClosed(tabId);
  }, [streamConnectionId, tabId, markClosed]);

  /**
   * Save the current tab to disk as a `.bru` file. If the tab already has a
   * savedPath, write straight there; otherwise show a save dialog so the
   * user can pick the destination (defaulting to the open workspace root).
   */
  const onSave = useCallback(async () => {
    if (savingState === "saving") return;
    setSavingState("saving");
    setError(null);
    try {
      let targetPath = activeTab.savedPath;
      let targetName = activeTab.name;
      if (!targetPath) {
        // Prefer the tab's name if the user already picked one
        // (e.g. via "New request here" → typed "list-users"). Otherwise
        // fall back to the URL's last path segment.
        const isAutoGenName = /^(?:Request \d+|Untitled|New request)$/.test(activeTab.name);
        const baseName = isAutoGenName
          ? (request.url.split("/").filter(Boolean).pop() ?? "request")
          : activeTab.name;
        const defaultName = `${baseName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40) || "request"}.bru`;
        // Prefer the tab's suggested folder (from "New request here") over
        // the workspace root, so right-clicking a folder really does default
        // the Save dialog inside that folder.
        const defaultDir = activeTab.suggestedSaveDir ?? workspaceRoot;
        const picked = await saveDialog({
          defaultPath: defaultDir ? `${defaultDir}/${defaultName}` : defaultName,
          filters: [{ name: "Bruno request", extensions: ["bru"] }],
        });
        if (typeof picked !== "string") {
          setSavingState("idle");
          return;
        }
        targetPath = picked;
        // Derive the tab's display name from the file stem.
        const stem = picked.split(/[/\\]/).pop() ?? defaultName;
        targetName = stem.replace(/\.bru$/i, "");
      }
      const collection = toCollectionRequest(
        targetName,
        request.url,
        request.method,
        request.headers,
        request.query,
        request.body,
        auth,
        request.vars,
        request.preRequestScript ?? "",
        request.postResponseScript ?? "",
      );
      await writeRequest(targetPath, collection);
      markTabSaved(activeTab.id, targetPath, targetName);
      // Refresh sidebar so the new file shows up (only if inside the workspace).
      if (workspaceRoot && targetPath.startsWith(workspaceRoot)) {
        void refreshWorkspace();
      }
      setSavingState("saved");
      setTimeout(() => setSavingState("idle"), 1500);
    } catch (e) {
      setError(`Save failed: ${String(e)}`);
      setSavingState("idle");
    }
  }, [
    savingState,
    activeTab,
    request,
    auth,
    workspaceRoot,
    markTabSaved,
    refreshWorkspace,
    setError,
  ]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        // gRPC's Call lives in the GrpcEditor surface — the url-bar doesn't
        // own a send action for it, so Ctrl+Enter is a no-op here.
        if (isGrpc) return;
        if (isStreaming) {
          if (isConnected) void onDisconnect();
          else void onConnect();
        } else {
          void onSend();
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void onSave();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "l") {
        // Browser-style address-bar focus. Select the existing URL so the
        // user can type a replacement immediately.
        e.preventDefault();
        urlInputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSend, onSave, onConnect, onDisconnect, isStreaming, isConnected, isGrpc]);

  /**
   * Intercept paste: if clipboard contains a cURL command, defer auto-fill
   * into the URL and show an inline action chip "Parse as cURL" instead.
   * Press Enter on the chip (or click it) to apply.
   */
  const onPaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData("text");
    if (text && CURL_PREFIX.test(text)) {
      e.preventDefault();
      setPendingCurl(text);
    }
  }, []);

  const applyCurl = useCallback(async () => {
    if (!pendingCurl) return;
    setParsingCurl(true);
    setError(null);
    try {
      const req = await parseCurl(pendingCurl);
      setUrl(req.url);
      if (isMethod(req.method)) setMethod(req.method);
      // Hydrate headers/query/body from the parsed cURL into the editor.
      setHeaders(tuplesToKvRows(req.headers));
      setQuery(tuplesToKvRows(req.query));
      setBody(wireBodyToEditor(req.body));
      setPendingCurl(null);
    } catch (err) {
      setError(`cURL parse failed: ${String(err)}`);
    } finally {
      setParsingCurl(false);
    }
  }, [pendingCurl, setUrl, setMethod, setHeaders, setQuery, setBody, setError]);

  const dismissCurl = useCallback(() => setPendingCurl(null), []);

  const hasUrl = request.url.length > 0;

  return (
    <div className="relative flex shrink-0 flex-col gap-0 border-border border-b bg-card">
      <div className="flex items-center gap-2 px-3 py-2">
        <ModeSelect value={mode} onChange={setMode} disabled={isConnected} />

        {/* HTTP method only matters for HTTP mode; hidden for SSE/WebSocket. */}
        {!isStreaming && <MethodSelect value={request.method} onChange={setMethod} />}

        <div className="group/url relative flex-1">
          <UrlEditor
            ref={urlInputRef}
            value={request.url}
            onChange={setUrl}
            onPaste={onPaste}
            placeholder={isGrpc ? "http://localhost:50051" : "https://api.example.com/v1/users"}
            varNames={varNames}
            className="cursor-text pr-8 transition-shadow duration-150 focus-within:shadow-[var(--shadow-glow)]"
            onEnter={() => {
              if (isGrpc) return;
              if (isStreaming) {
                if (isConnected) void onDisconnect();
                else void onConnect();
              } else {
                void onSend();
              }
            }}
            aria-label="Request URL"
          />
          {hasUrl && !loading && (
            <button
              type="button"
              onClick={() => setUrl("")}
              className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm text-muted-foreground/60 opacity-0 transition-all duration-150 hover:bg-accent hover:text-foreground group-hover/url:opacity-100 group-focus-within/url:opacity-100"
              aria-label="Clear URL"
              title="Clear URL"
            >
              <XIcon className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => void onSave()}
          disabled={savingState === "saving"}
          className="h-9 w-9 shrink-0 cursor-pointer p-0 text-muted-foreground transition-colors hover:text-foreground"
          title={
            activeTab.savedPath ? `Save ${activeTab.name} (Ctrl+S)` : "Save request as… (Ctrl+S)"
          }
          aria-label="Save request"
        >
          {savingState === "saved" ? (
            <CheckIcon
              className="size-4 text-[color:var(--color-success)]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          ) : savingState === "saving" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <SaveIcon className="size-4" strokeWidth={1.75} aria-hidden="true" />
          )}
        </Button>

        {isGrpc ? (
          // gRPC's Call button lives in the GrpcEditor surface below; the
          // url-bar only carries the endpoint for this mode.
          <span className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 font-mono font-semibold text-[10px] text-muted-foreground tracking-wide">
            ENDPOINT
          </span>
        ) : isStreaming ? (
          <Button
            onClick={() => (isConnected ? void onDisconnect() : void onConnect())}
            disabled={!hasUrl && !isConnected}
            variant={isConnected ? "destructive" : "default"}
            className="gap-1.5 cursor-pointer shadow-sm transition-all duration-150 hover:-translate-y-px hover:shadow-md active:scale-[0.98] active:translate-y-0 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-sm"
            title={isConnected ? `Disconnect (${SEND_HINT})` : `Connect (${SEND_HINT})`}
            aria-keyshortcuts={isMac ? "Meta+Enter" : "Control+Enter"}
          >
            {streamStatus === "connecting" ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : isConnected ? (
              <PlugZapIcon className="size-3.5" aria-hidden="true" />
            ) : (
              <PlugIcon className="size-3.5" aria-hidden="true" />
            )}
            <span>{isConnected ? "Disconnect" : "Connect"}</span>
          </Button>
        ) : loading ? (
          // While a request is in flight the Send button becomes a destructive
          // Cancel button that aborts it via the backend `cancel_request`.
          <Button
            onClick={() => void onCancel()}
            variant="destructive"
            className="gap-1.5 cursor-pointer shadow-sm transition-all duration-150 hover:-translate-y-px hover:shadow-md active:scale-[0.98] active:translate-y-0"
            title="Cancel request"
            aria-label="Cancel request"
          >
            <XIcon className="size-3.5" aria-hidden="true" />
            <span>Cancel</span>
          </Button>
        ) : (
          <Button
            onClick={() => void onSend()}
            disabled={!hasUrl}
            className="shine-on-hover gap-1.5 cursor-pointer shadow-sm transition-all duration-150 hover:-translate-y-px hover:shadow-md active:scale-[0.98] active:translate-y-0 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-sm"
            title={`Send request (${SEND_HINT})`}
            aria-keyshortcuts={isMac ? "Meta+Enter" : "Control+Enter"}
          >
            <SendHorizontalIcon
              className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5"
              aria-hidden="true"
            />
            <span>Send</span>
            <kbd className="ml-1 hidden rounded border border-primary-foreground/20 bg-primary-foreground/15 px-1 font-mono text-[10px] text-primary-foreground/80 shadow-xs nums-tabular sm:inline">
              {SEND_HINT}
            </kbd>
          </Button>
        )}

        {!isStreaming && !isGrpc && <CopyAsMenu request={request} />}
      </div>

      <VarResolvedPreview />

      {/* Neutral notice after the user cancels an in-flight request. */}
      {cancelled && !loading && (
        <div
          className="flex items-center gap-2 border-border/50 border-t bg-muted/40 px-3 py-1.5 text-muted-foreground text-xs fade-in-0 slide-in-from-top-1 animate-in"
          role="status"
        >
          <XIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span>Request cancelled.</span>
        </div>
      )}

      {/* Inline cURL chip — slides down when a cURL command is pasted */}
      {pendingCurl && (
        <div
          className="flex items-center justify-between gap-3 border-border/50 border-t bg-primary/5 px-3 py-1.5 fade-in-0 slide-in-from-top-1 animate-in"
          role="status"
        >
          <div className="flex min-w-0 items-center gap-2 text-xs">
            <TerminalIcon
              className="size-3.5 shrink-0 text-[color:var(--color-primary)]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <span className="font-medium text-foreground">Detected cURL command.</span>
            <span className="truncate font-mono text-muted-foreground">
              {pendingCurl.slice(0, 60)}
              {pendingCurl.length > 60 && "…"}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={dismissCurl}
              className="h-6 cursor-pointer px-2 text-xs"
            >
              Dismiss
            </Button>
            <Button
              size="sm"
              onClick={() => void applyCurl()}
              disabled={parsingCurl}
              className="h-6 cursor-pointer gap-1 px-2 text-xs disabled:cursor-not-allowed"
            >
              {parsingCurl ? (
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              ) : (
                <TerminalIcon className="size-3" strokeWidth={1.75} aria-hidden="true" />
              )}
              Parse cURL
            </Button>
          </div>
        </div>
      )}

      {/* Loading progress bar — flows left to right while pending */}
      {loading && (
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px overflow-hidden">
          <div className="absolute inset-y-0 w-1/3 animate-[urlbar-shimmer_1.2s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-primary to-transparent" />
        </div>
      )}
    </div>
  );
}
