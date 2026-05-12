import { Loader2, SendHorizontalIcon, XIcon } from "lucide-react";
import { useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sendRequest } from "@/lib/tauri";
import { useEnv } from "@/stores/env-store";
import { useRequest } from "@/stores/request-store";
import { useWorkspace } from "@/stores/workspace-store";
import { CopyAsMenu } from "./copy-as-menu";
import { MethodSelect } from "./method-select";

const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const SEND_HINT = isMac ? "⌘↵" : "Ctrl+↵";

export function UrlBar() {
  const request = useRequest((s) => s.request);
  const auth = useRequest((s) => s.auth);
  const loading = useRequest((s) => s.loading);
  const setUrl = useRequest((s) => s.setUrl);
  const setMethod = useRequest((s) => s.setMethod);
  const setResponse = useRequest((s) => s.setResponse);
  const setLoading = useRequest((s) => s.setLoading);
  const setError = useRequest((s) => s.setError);
  const workspaceRoot = useWorkspace((s) => s.rootPath);
  const activeEnv = useEnv((s) => s.activeEnv);

  const onSend = useCallback(async () => {
    if (!request.url || loading) return;
    setError(null);
    setLoading(true);
    try {
      const resp = await sendRequest(request, auth, {
        workspaceRoot: workspaceRoot ?? undefined,
        envName: activeEnv,
      });
      setResponse(resp);
    } catch (e) {
      setError(String(e));
      setResponse(null);
    } finally {
      setLoading(false);
    }
  }, [request, auth, loading, workspaceRoot, activeEnv, setError, setLoading, setResponse]);

  // Global Cmd+Enter / Ctrl+Enter shortcut to send (regardless of focus).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void onSend();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSend]);

  const hasUrl = request.url.length > 0;

  return (
    <div className="flex shrink-0 items-center gap-2 border-border border-b bg-card px-3 py-2">
      <MethodSelect value={request.method} onChange={setMethod} />

      <div className="relative flex-1">
        <Input
          value={request.url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://api.example.com/v1/users"
          className="pr-8 font-mono"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void onSend();
            }
          }}
          aria-label="Request URL"
        />
        {hasUrl && !loading && (
          <button
            type="button"
            onClick={() => setUrl("")}
            className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Clear URL"
            title="Clear URL"
          >
            <XIcon className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      <Button
        onClick={() => void onSend()}
        disabled={loading || !hasUrl}
        className="gap-1.5 active:scale-[0.98] transition-transform"
        title={`Send request (${SEND_HINT})`}
        aria-keyshortcuts={isMac ? "Meta+Enter" : "Control+Enter"}
      >
        {loading ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <SendHorizontalIcon className="size-3.5" aria-hidden="true" />
        )}
        <span>{loading ? "Sending" : "Send"}</span>
        {!loading && (
          <kbd className="ml-1 hidden rounded bg-primary-foreground/15 px-1 font-mono text-[10px] text-primary-foreground/70 sm:inline">
            {SEND_HINT}
          </kbd>
        )}
      </Button>

      <CopyAsMenu request={request} />
    </div>
  );
}
