import {
  CheckIcon,
  CircleDashedIcon,
  Loader2,
  PlayIcon,
  StopCircleIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { runCaptures } from "@/lib/captures";
import { requestFromCollection } from "@/lib/collection-convert";
import { methodColor } from "@/lib/method-color";
import { readRequest, sendRequest } from "@/lib/tauri";
import { bodyToWire, isMethod, kvRowsToTuples, type Method } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useCaptures } from "@/stores/captures-store";
import { useEnv } from "@/stores/env-store";
import { useTabs } from "@/stores/request-store";
import { useRunner } from "@/stores/runner-store";
import { useUi } from "@/stores/ui-store";
import { useWorkspace } from "@/stores/workspace-store";

/**
 * Sequential collection runner. Reads every `.bru` file inside the chosen
 * folder, sends them one by one, and records pass/fail (default rule: 2xx).
 *
 * Captures cascade: a `{{token}}` set by request #1 is available to request
 * #5. Uses the same env overlay store as the editor so chains feel natural.
 */
export function CollectionRunner() {
  const open = useRunner((s) => s.open);
  const folder = useRunner((s) => s.folder);
  const steps = useRunner((s) => s.steps);
  const running = useRunner((s) => s.running);
  const startRun = useRunner((s) => s.startRun);
  const setStepStatus = useRunner((s) => s.setStepStatus);
  const cancelRun = useRunner((s) => s.cancelRun);
  const finish = useRunner((s) => s.finish);
  const close = useRunner((s) => s.close);
  const openFor = useRunner((s) => s.openFor);

  // Command palette / sidebar context menu → open runner channel.
  const pendingAction = useUi((s) => s.pendingAction);
  const clearPendingAction = useUi((s) => s.clearPendingAction);
  useEffect(() => {
    if (pendingAction?.type === "run-folder") {
      openFor(pendingAction.folderPath);
      clearPendingAction();
    }
  }, [pendingAction, openFor, clearPendingAction]);

  const items = useWorkspace((s) => s.items);
  const workspaceRoot = useWorkspace((s) => s.rootPath);
  const activeEnv = useEnv((s) => s.activeEnv);
  const getOverlayForEnv = useCaptures((s) => s.getForEnv);
  const setCapturedMany = useCaptures((s) => s.setMany);

  // Compute candidate `.bru` files for the chosen folder (or workspace root).
  const candidates = useMemo(() => {
    if (!folder) return [] as { path: string; name: string; method: string }[];
    const sep = folder.includes("\\") ? "\\" : "/";
    const prefix = folder.endsWith(sep) ? folder : folder + sep;
    return items
      .filter((it) => it.kind === "file" && (it.path === folder || it.path.startsWith(prefix)))
      .map((it) => ({ path: it.path, name: it.name, method: it.method }));
  }, [folder, items]);

  const passed = steps.filter((s) => s.status === "passed").length;
  const failed = steps.filter((s) => s.status === "failed").length;
  const total = steps.length;
  const inFlight = running;

  /**
   * Walk the candidate list one request at a time. Each iteration:
   *  1. reads the `.bru`,
   *  2. materialises a wire request,
   *  3. sends with the latest overlay vars,
   *  4. runs the request's own captures so later steps see fresh tokens.
   */
  async function execute() {
    const initialSteps = candidates.map<{
      path: string;
      name: string;
      method: string;
      status: "pending";
      httpStatus: number;
      elapsedMs: number;
    }>((c) => ({
      path: c.path,
      name: c.name,
      method: c.method,
      status: "pending",
      httpStatus: 0,
      elapsedMs: 0,
    }));
    startRun(folder ?? "", initialSteps);

    for (let i = 0; i < initialSteps.length; i++) {
      if (useRunner.getState().cancelRequested) break;
      setStepStatus(i, { status: "running" });

      const step = initialSteps[i];
      try {
        const req = await readRequest(step.path);
        const method: Method = isMethod(req.method) ? req.method : "GET";
        const editor = requestFromCollection(req);
        const wire = bodyToWire(editor.body);
        const httpReq = {
          url: req.url,
          method,
          headers: kvRowsToTuples(editor.headers),
          query: kvRowsToTuples(editor.query),
          body: wire,
        };
        // Same precedence chain as the manual editor: per-request `vars`
        // override env file values, overlay (captures cascade) overrides
        // everything. Last write wins in Rust's HashMap insert.
        const reqVars = kvRowsToTuples(editor.vars);
        const overlayVars = getOverlayForEnv(activeEnv);
        const extraVars = [...reqVars, ...overlayVars];
        const resp = await sendRequest(httpReq, editor.auth, {
          workspaceRoot: workspaceRoot ?? undefined,
          envName: activeEnv,
          requestPath: step.path,
          extraVars: extraVars.length > 0 ? extraVars : undefined,
        });
        // Default pass rule: any 2xx
        const ok = resp.status >= 200 && resp.status < 300;
        setStepStatus(i, {
          status: ok ? "passed" : "failed",
          httpStatus: resp.status,
          elapsedMs: resp.elapsedMs,
        });

        // If the user has this request open in a tab AND defined captures
        // on it, run them so later steps in this run see the freshly
        // extracted token. Captures are session-only and live in tab state
        // (not on disk yet), so unopened requests don't contribute.
        const tabs = useTabs.getState().tabs;
        const matchingTab = tabs.find((t) => t.savedPath === step.path);
        if (matchingTab && matchingTab.request.captures.length > 0) {
          const captured = runCaptures(matchingTab.request.captures, resp.bodyText);
          if (captured.length > 0) {
            setCapturedMany(activeEnv, captured);
          }
        }
      } catch (e) {
        setStepStatus(i, {
          status: "failed",
          error: String(e),
        });
      }
    }
    finish();
  }

  // ── Cancel button is exclusive with Start; reset state when closing ──
  const [startedOnce, setStartedOnce] = useState(false);
  useEffect(() => {
    if (!open) setStartedOnce(false);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlayIcon className="size-4 text-primary" strokeWidth={1.75} aria-hidden="true" />
            Collection runner
          </DialogTitle>
          <DialogDescription>
            Run every <code className="font-mono">.bru</code> in this folder sequentially. Captures
            cascade between requests; default pass rule is 2xx.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-card/40 p-2 text-xs">
            <div className="min-w-0 truncate">
              <span className="text-muted-foreground">Folder · </span>
              <span className="font-mono text-foreground">{folder ?? "—"}</span>
            </div>
            <div className="shrink-0 nums-tabular text-muted-foreground">
              {candidates.length} request{candidates.length === 1 ? "" : "s"}
            </div>
          </div>

          {steps.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-border/60 border-dashed bg-mesh-primary p-6 text-center">
              <PlayIcon
                className="size-7 text-muted-foreground/40"
                strokeWidth={1.25}
                aria-hidden="true"
              />
              <p className="font-medium text-foreground text-sm">Ready to run</p>
              <p className="max-w-[40ch] text-muted-foreground text-xs">
                {candidates.length === 0
                  ? "No .bru files found in this folder."
                  : `Click Run to send ${candidates.length} requests sequentially.`}
              </p>
            </div>
          )}

          {steps.length > 0 && (
            <ul className="max-h-80 space-y-1 overflow-y-auto rounded-md border border-border/60 p-1">
              {steps.map((s) => {
                const c = methodColor(s.method);
                return (
                  <li
                    key={s.path}
                    className={cn(
                      "flex items-center gap-2 rounded-sm border px-2 py-1.5",
                      s.status === "passed" &&
                        "border-[color:var(--color-success)]/20 bg-[color:var(--color-success)]/5",
                      s.status === "failed" && "border-destructive/30 bg-destructive/5",
                      s.status === "running" && "border-primary/40 bg-primary/5",
                      s.status === "pending" && "border-border/60 bg-card/40",
                    )}
                  >
                    <span className="grid size-5 shrink-0 place-items-center" aria-hidden="true">
                      {s.status === "passed" && (
                        <CheckIcon
                          className="size-3.5 text-[color:var(--color-success)]"
                          strokeWidth={2.25}
                        />
                      )}
                      {s.status === "failed" && (
                        <XIcon className="size-3.5 text-destructive" strokeWidth={2.25} />
                      )}
                      {s.status === "running" && (
                        <Loader2 className="size-3.5 animate-spin text-primary" />
                      )}
                      {s.status === "pending" && (
                        <CircleDashedIcon className="size-3.5 text-muted-foreground/40" />
                      )}
                    </span>
                    <span
                      className="min-w-12 shrink-0 rounded-[3px] border px-1.5 py-px text-center font-mono font-semibold text-[10px] uppercase tracking-wider"
                      style={{
                        color: c,
                        backgroundColor: `color-mix(in oklch, ${c} 14%, transparent)`,
                        borderColor: `color-mix(in oklch, ${c} 25%, transparent)`,
                      }}
                    >
                      {s.method || "—"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs">{s.name}</span>
                    {s.httpStatus > 0 && (
                      <span className="shrink-0 nums-tabular text-[11px] text-muted-foreground">
                        {s.httpStatus} · {s.elapsedMs}ms
                      </span>
                    )}
                    {s.error && (
                      <span
                        className="ml-auto shrink-0 truncate text-[11px] text-destructive"
                        title={s.error}
                      >
                        {s.error.length > 40 ? `${s.error.slice(0, 40)}…` : s.error}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {steps.length > 0 && !inFlight && (
            <div className="flex items-center gap-3 rounded-md border border-border/60 bg-card/40 px-3 py-2 text-xs">
              <span className="text-muted-foreground">Result</span>
              <span className="font-semibold text-[color:var(--color-success)] nums-tabular">
                {passed} passed
              </span>
              <span className="font-semibold text-destructive nums-tabular">{failed} failed</span>
              <span className="ml-auto text-muted-foreground nums-tabular">{total} total</span>
            </div>
          )}
        </div>

        <DialogFooter>
          {inFlight ? (
            <Button variant="destructive" size="sm" onClick={cancelRun} className="gap-1.5">
              <StopCircleIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
              Cancel
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={close}>
                Close
              </Button>
              <Button
                size="sm"
                disabled={candidates.length === 0}
                onClick={() => {
                  setStartedOnce(true);
                  void execute();
                }}
                className="gap-1.5"
              >
                <PlayIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                {startedOnce ? "Run again" : "Run"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
