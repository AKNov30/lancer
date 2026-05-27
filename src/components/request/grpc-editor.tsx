import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  FileCode2Icon,
  Loader2,
  SendHorizontalIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/code-editor";
import { KvTable } from "@/components/ui/kv-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CANCELLED_SENTINEL,
  cancelRequest,
  grpcListMethods,
  grpcUnaryCall,
  resolveVars,
} from "@/lib/tauri";
import { kvRowsToTuples } from "@/lib/types";
import { useCaptures } from "@/stores/captures-store";
import { useEnv } from "@/stores/env-store";
import { EMPTY, methodKey, useGrpc } from "@/stores/grpc-store";
import { useRequest, useTabs } from "@/stores/request-store";
import { useWorkspace } from "@/stores/workspace-store";

/**
 * Resolve a single template string (e.g. `{{baseUrl}}/x`) against the active
 * variable context. Returns the input unchanged on failure so a resolve error
 * never blocks a call — the raw string is sent, matching the worst case before
 * substitution existed.
 */
function applyVars(text: string, resolved: Map<string, string>): string {
  return text.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (whole, name: string) =>
    resolved.has(name) ? (resolved.get(name) as string) : whole,
  );
}

/** Short file name from an absolute path, for the loaded-proto chip. */
function baseName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

/**
 * gRPC editor surface, shown in the editor column when the active tab's mode
 * is `"grpc"`. Lets the user:
 *   1. pick a `.proto` file (parsed at runtime in Rust),
 *   2. choose a service + method (unary only — streaming methods are disabled),
 *   3. edit a JSON request body + metadata,
 *   4. Call the endpoint (from the URL field) and view the JSON response.
 *
 * All state is per-tab and session-scoped via {@link useGrpc}.
 */
export function GrpcEditor() {
  const tabId = useTabs((s) => s.activeId);
  const endpoint = useRequest((s) => s.request.url);
  const requestVarsRaw = useRequest((s) => s.request.vars);
  const activeTab = useTabs((s) => s.tabs.find((t) => t.id === s.activeId) ?? s.tabs[0]);
  const workspaceRoot = useWorkspace((s) => s.rootPath);
  const activeEnv = useEnv((s) => s.activeEnv);
  const getOverlayForEnv = useCaptures((s) => s.getForEnv);
  const st = useGrpc((s) => s.byTab[tabId]) ?? EMPTY;
  const patch = useGrpc((s) => s.patch);

  /**
   * Id of the in-flight call, generated per-call so the user can cancel it via
   * the backend `cancel_request`. A ref (not state) so the Cancel button reads
   * the latest id without a re-render. Mirrors url-bar's `inFlightRequestId`.
   */
  const inFlightRequestId = useRef<string | null>(null);
  /** Brief neutral notice shown after the user cancels a call. */
  const [cancelled, setCancelled] = useState(false);

  const loadProto = useCallback(async () => {
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: "Protocol Buffers", extensions: ["proto"] }],
    });
    if (typeof picked !== "string") return;
    patch(tabId, { loading: true, error: null });
    try {
      const methods = await grpcListMethods(picked);
      // Auto-select the first unary method so the body editor isn't blank.
      const firstUnary = methods.find((m) => !m.clientStreaming && !m.serverStreaming);
      patch(tabId, {
        protoPath: picked,
        methods,
        selected: firstUnary ? methodKey(firstUnary) : null,
        loading: false,
        response: null,
      });
    } catch (e) {
      // Parse failed: clear methods + selection + response so the method
      // dropdown can't point at a stale method from a previously-loaded proto.
      patch(tabId, {
        loading: false,
        error: String(e),
        methods: [],
        selected: null,
        response: null,
        protoPath: picked,
      });
    }
  }, [tabId, patch]);

  const onCall = useCallback(async () => {
    if (!st.selected || !endpoint) return;
    const selectedMethod = st.methods.find((m) => methodKey(m) === st.selected);
    if (!selectedMethod || !st.protoPath) return;
    setCancelled(false);
    patch(tabId, { loading: true, error: null, response: null });
    // Generate a fresh id so this call can be aborted mid-flight.
    const requestId = crypto.randomUUID();
    inFlightRequestId.current = requestId;
    try {
      // Resolve `{{var}}` templates before the call so gRPC matches HTTP — the
      // endpoint, each metadata value, and the JSON body all get substituted.
      // Same env/overlay layering and Rust `resolve_vars` call url-bar uses.
      const extraVars = [...kvRowsToTuples(requestVarsRaw), ...getOverlayForEnv(activeEnv)];
      const resolvedList = await resolveVars({
        workspaceRoot: workspaceRoot ?? undefined,
        envName: activeEnv,
        requestPath: activeTab.savedPath ?? undefined,
        extraVars: extraVars.length > 0 ? extraVars : undefined,
      });
      const resolved = new Map(resolvedList.map((v) => [v.name, v.value]));

      const resolvedMetadata = kvRowsToTuples(st.metadata).map(
        ([k, v]) => [k, applyVars(v, resolved)] as [string, string],
      );
      const resp = await grpcUnaryCall({
        protoPath: st.protoPath,
        endpoint: applyVars(endpoint, resolved),
        service: selectedMethod.service,
        method: selectedMethod.method,
        jsonBody: applyVars(st.jsonBody, resolved),
        metadata: resolvedMetadata,
        requestId,
      });
      patch(tabId, { loading: false, response: resp });
    } catch (e) {
      // The backend returns the cancel sentinel when the user aborted the
      // call — surface that as a NEUTRAL notice, not a red error (matches HTTP).
      if (String(e).includes(CANCELLED_SENTINEL)) {
        setCancelled(true);
        patch(tabId, { loading: false, response: null });
      } else {
        patch(tabId, { loading: false, error: String(e) });
      }
    } finally {
      inFlightRequestId.current = null;
    }
  }, [
    st.selected,
    st.methods,
    st.protoPath,
    st.jsonBody,
    st.metadata,
    endpoint,
    requestVarsRaw,
    workspaceRoot,
    activeEnv,
    activeTab.savedPath,
    getOverlayForEnv,
    tabId,
    patch,
  ]);

  /**
   * Abort the in-flight call. Best-effort: the backend no-ops if the call
   * already finished. The awaited `grpcUnaryCall` in `onCall` then rejects with
   * the cancel sentinel, clearing `loading` and showing the neutral notice.
   */
  const onCancel = useCallback(async () => {
    const id = inFlightRequestId.current;
    if (!id) return;
    try {
      await cancelRequest(id);
    } catch {
      /* call may already be gone — onCall's catch handles the outcome */
    }
  }, []);

  const selectedMethod = st.methods.find((m) => methodKey(m) === st.selected);
  const isStreamingMethod =
    selectedMethod && (selectedMethod.clientStreaming || selectedMethod.serverStreaming);
  const canCall = Boolean(st.selected && endpoint && !isStreamingMethod && !st.loading);
  // A proto loaded fine but exposes only streaming methods (no callable unary).
  const onlyStreamingMethods =
    st.protoPath !== null &&
    !st.error &&
    st.methods.length > 0 &&
    st.methods.every((m) => m.clientStreaming || m.serverStreaming);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
      {/* Proto file + method picker */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadProto()}
          className={`h-9 cursor-pointer gap-1.5 ${
            st.error ? "border-destructive/50 text-destructive hover:text-destructive" : ""
          }`}
          title="Pick a .proto file to parse"
        >
          <FileCode2Icon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
          {st.protoPath ? baseName(st.protoPath) : "Load .proto…"}
        </Button>

        <Select
          value={st.selected ?? ""}
          onValueChange={(v) => patch(tabId, { selected: v, response: null })}
          disabled={st.methods.length === 0}
        >
          <SelectTrigger
            className="h-9 min-w-[220px] flex-1 font-mono text-xs"
            aria-label="gRPC service and method"
          >
            <SelectValue placeholder="Select a method…" />
          </SelectTrigger>
          <SelectContent>
            {st.methods.map((m) => {
              const streaming = m.clientStreaming || m.serverStreaming;
              return (
                <SelectItem
                  key={methodKey(m)}
                  value={methodKey(m)}
                  disabled={streaming}
                  className="font-mono text-xs"
                >
                  {m.service}/{m.method}
                  {streaming && " (streaming — not supported)"}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        {st.loading ? (
          // While a call is in flight the Call button becomes a destructive
          // Cancel button that aborts it via the backend `cancel_request`.
          <Button
            onClick={() => void onCancel()}
            variant="destructive"
            className="gap-1.5 cursor-pointer shadow-sm transition-all duration-150 hover:-translate-y-px hover:shadow-md active:scale-[0.98] active:translate-y-0"
            title="Cancel call"
            aria-label="Cancel call"
          >
            <XIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            <span>Cancel</span>
          </Button>
        ) : (
          <Button
            onClick={() => void onCall()}
            disabled={!canCall}
            className="shine-on-hover gap-1.5 cursor-pointer shadow-sm transition-all duration-150 hover:-translate-y-px hover:shadow-md active:scale-[0.98] active:translate-y-0 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-sm"
            title={
              endpoint
                ? "Call method"
                : "Enter an endpoint in the URL bar (e.g. http://localhost:50051)"
            }
          >
            <SendHorizontalIcon
              className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <span>Call</span>
          </Button>
        )}
      </div>

      {/* Parse error co-located with the Load .proto chip. */}
      {st.error && (
        <div
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-xs"
          role="alert"
        >
          <XCircleIcon className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <span className="break-words font-mono">{st.error}</span>
        </div>
      )}

      {/* Loaded proto exposes only streaming methods — none are callable yet. */}
      {onlyStreamingMethods && (
        <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-muted-foreground text-xs">
          <AlertCircleIcon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          This service only exposes streaming methods, which aren&apos;t supported yet.
        </div>
      )}

      {/* In-flight notice: which method is being called. */}
      {st.loading && selectedMethod && (
        <div
          className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-muted-foreground text-xs"
          role="status"
        >
          <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
          <span className="font-mono">
            Calling {selectedMethod.service}/{selectedMethod.method}…
          </span>
        </div>
      )}

      {/* Neutral notice after the user cancels an in-flight call. */}
      {cancelled && !st.loading && (
        <div
          className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-muted-foreground text-xs fade-in-0 slide-in-from-top-1 animate-in"
          role="status"
        >
          <XIcon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <span>Call cancelled.</span>
        </div>
      )}

      {/* Selected method input/output types */}
      {selectedMethod && (
        <div className="font-mono text-muted-foreground text-xs">
          <span className="text-foreground">{selectedMethod.inputType}</span>
          {" → "}
          <span className="text-foreground">{selectedMethod.outputType}</span>
        </div>
      )}

      {!endpoint && (
        <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-muted-foreground text-xs">
          <AlertCircleIcon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          Enter an endpoint in the URL bar, e.g. <code>http://localhost:50051</code>
        </div>
      )}

      {/* Request body */}
      <div className="flex flex-col gap-1">
        <span className="font-medium text-muted-foreground text-xs">Request (JSON)</span>
        <CodeEditor
          value={st.jsonBody}
          onChange={(v) => patch(tabId, { jsonBody: v })}
          language="json"
          minHeight="140px"
          placeholder='{ "name": "world" }'
        />
      </div>

      {/* Metadata */}
      <div className="flex flex-col gap-1">
        <span className="font-medium text-muted-foreground text-xs">Metadata</span>
        <KvTable
          rows={st.metadata}
          onChange={(rows) => patch(tabId, { metadata: rows })}
          keyPlaceholder="authorization"
          valuePlaceholder="Bearer …"
        />
      </div>

      {/* Response */}
      {st.response && <GrpcResult />}
    </div>
  );
}

/** Status + JSON body of the last gRPC call. */
function GrpcResult() {
  const tabId = useTabs((s) => s.activeId);
  const response = useGrpc((s) => s.byTab[tabId]?.response ?? null);
  if (!response) return null;

  const ok = response.statusCode === 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs">
        {ok ? (
          <CheckCircle2Icon
            className="size-3.5 text-[color:var(--color-success)]"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        ) : (
          <XCircleIcon
            className="size-3.5 text-[color:var(--color-destructive)]"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        )}
        <span
          className="font-medium font-mono"
          style={{
            color: ok ? "var(--color-success)" : "var(--color-destructive)",
          }}
        >
          {response.statusCode} {response.message}
        </span>
        <span className="ml-auto nums-tabular text-muted-foreground">{response.timeMs} ms</span>
      </div>
      {ok && (
        <CodeEditor
          value={response.bodyJson || "{}"}
          onChange={() => {}}
          language="json"
          readOnly
          minHeight="120px"
        />
      )}
    </div>
  );
}
