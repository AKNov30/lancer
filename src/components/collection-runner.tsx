import {
  CheckCircle2Icon,
  CheckIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  Loader2,
  PlayIcon,
  StopCircleIcon,
  XCircleIcon,
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
import { stepVerdict } from "@/lib/step-verdict";
import { readRequest, sendRequest } from "@/lib/tauri";
import { bodyToWire, isMethod, kvRowsToTuples, type Method } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useCaptures } from "@/stores/captures-store";
import { useEnv } from "@/stores/env-store";
import { useTabs } from "@/stores/request-store";
import { type RunStep, useRunner } from "@/stores/runner-store";
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
  // Aggregate assertion outcomes across all steps for the run summary, so the
  // result line reflects assertion failures and not just non-2xx steps.
  const assertionsTotal = steps.reduce((n, s) => n + (s.tests?.length ?? 0), 0);
  const assertionsFailed = steps.reduce(
    (n, s) => n + (s.tests?.filter((t) => !t.passed).length ?? 0),
    0,
  );
  const inFlight = running;

  /**
   * Walk the candidate list one request at a time. Each iteration:
   *  1. reads the `.bru`,
   *  2. materialises a wire request,
   *  3. sends with the latest overlay vars,
   *  4. runs the request's own captures so later steps see fresh tokens.
   */
  async function execute() {
    const initialSteps = candidates.map<RunStep>((c) => ({
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
          // Forward the request's own scripts so `lancer.test(...)` assertions
          // actually run during the run — without these the backend skips
          // post-response scripting and `resp.tests` comes back empty.
          preRequestScript: editor.preRequestScript || undefined,
          postResponseScript: editor.postResponseScript || undefined,
        });
        // Pass rule: a transport success (2xx) AND, when the request defines
        // assertions, all of them passing (and no script error). Requests with
        // no assertions fall back to the legacy 2xx-only rule.
        const transportOk = resp.status >= 200 && resp.status < 300;
        const verdict = stepVerdict({
          transportOk,
          tests: resp.tests ?? [],
          scriptError: resp.scriptError,
        });
        setStepStatus(i, {
          status: verdict.passed ? "passed" : "failed",
          httpStatus: resp.status,
          elapsedMs: resp.elapsedMs,
          tests: resp.tests ?? [],
          scriptError: resp.scriptError ?? null,
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
              {steps.map((s) => (
                <StepRow key={s.path} step={s} />
              ))}
            </ul>
          )}

          {steps.length > 0 && !inFlight && (
            <div className="flex items-center gap-3 rounded-md border border-border/60 bg-card/40 px-3 py-2 text-xs">
              <span className="text-muted-foreground">Result</span>
              <span className="font-semibold text-[color:var(--color-success)] nums-tabular">
                {passed} passed
              </span>
              <span className="font-semibold text-destructive nums-tabular">{failed} failed</span>
              {assertionsTotal > 0 && (
                <span
                  className="nums-tabular"
                  style={{
                    color:
                      assertionsFailed > 0
                        ? "var(--color-destructive)"
                        : "var(--color-muted-foreground)",
                  }}
                  title={`${assertionsTotal - assertionsFailed}/${assertionsTotal} assertions passed`}
                >
                  {assertionsFailed > 0
                    ? `${assertionsFailed} assertion${assertionsFailed === 1 ? "" : "s"} failed`
                    : `${assertionsTotal} assertion${assertionsTotal === 1 ? "" : "s"} passed`}
                </span>
              )}
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

/**
 * One step row plus its expandable assertion list. Kept as its own component so
 * each row owns its expand state. The assertion list reuses the response-viewer
 * Tests-tab visual pattern (icons, success/destructive colors, tabular nums)
 * for cross-surface consistency.
 */
function StepRow({ step: s }: { step: RunStep }) {
  const c = methodColor(s.method);
  const tests = s.tests ?? [];
  const passedCount = tests.filter((t) => t.passed).length;
  const failedCount = tests.length - passedCount;
  const hasDetails = tests.length > 0 || Boolean(s.scriptError);
  // Auto-expand failures so the reason is visible without a click.
  const [expanded, setExpanded] = useState(false);
  const showDetails = hasDetails && (expanded || s.status === "failed");

  return (
    <li
      className={cn(
        "rounded-sm border",
        s.status === "passed" &&
          "border-[color:var(--color-success)]/20 bg-[color:var(--color-success)]/5",
        s.status === "failed" && "border-destructive/30 bg-destructive/5",
        s.status === "running" && "border-primary/40 bg-primary/5",
        s.status === "pending" && "border-border/60 bg-card/40",
      )}
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span className="grid size-5 shrink-0 place-items-center" aria-hidden="true">
          {s.status === "passed" && (
            <CheckIcon className="size-3.5 text-[color:var(--color-success)]" strokeWidth={2.25} />
          )}
          {s.status === "failed" && (
            <XIcon className="size-3.5 text-destructive" strokeWidth={2.25} />
          )}
          {s.status === "running" && <Loader2 className="size-3.5 animate-spin text-primary" />}
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
        {tests.length > 0 && (
          <span
            className="shrink-0 rounded-sm px-1 nums-tabular text-[10px]"
            style={{
              color: failedCount > 0 ? "var(--color-destructive)" : "var(--color-success)",
              backgroundColor: `color-mix(in oklch, ${
                failedCount > 0 ? "var(--color-destructive)" : "var(--color-success)"
              } 14%, transparent)`,
            }}
            title={
              failedCount > 0
                ? `${passedCount}/${tests.length} passed — ${failedCount} failed`
                : `${passedCount}/${tests.length} passed`
            }
          >
            {passedCount}/{tests.length}
          </span>
        )}
        {s.httpStatus > 0 && (
          <span className="shrink-0 nums-tabular text-[11px] text-muted-foreground">
            {s.httpStatus} · {s.elapsedMs}ms
          </span>
        )}
        {s.error && (
          <span className="shrink-0 truncate text-[11px] text-destructive" title={s.error}>
            {s.error.length > 40 ? `${s.error.slice(0, 40)}…` : s.error}
          </span>
        )}
        {hasDetails && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
            aria-label={showDetails ? "Hide assertions" : "Show assertions"}
            aria-expanded={showDetails}
            title={showDetails ? "Hide assertions" : "Show assertions"}
          >
            <ChevronRightIcon
              className={cn("size-3.5 transition-transform", showDetails && "rotate-90")}
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </button>
        )}
      </div>

      {showDetails && (
        <div className="border-border/40 border-t px-2 pt-1 pb-1.5">
          {s.scriptError && (
            <div className="mb-1 rounded-sm border border-destructive/30 bg-destructive/5 px-2 py-1">
              <p className="font-medium text-destructive text-[11px]">Script error</p>
              <pre className="mt-0.5 whitespace-pre-wrap break-all font-mono text-[11px] text-destructive/90">
                {s.scriptError}
              </pre>
            </div>
          )}
          {tests.length > 0 && (
            <ul className="divide-y divide-border/40">
              {tests.map((t, idx) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: assertion results are a fixed list regenerated wholesale per send
                  key={`${idx}:${t.name}`}
                  className="flex items-start gap-2 py-1 font-mono text-[11px]"
                >
                  {t.passed ? (
                    <CheckCircle2Icon
                      className="mt-0.5 size-3.5 shrink-0 text-[color:var(--color-success)]"
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                  ) : (
                    <XCircleIcon
                      className="mt-0.5 size-3.5 shrink-0 text-[color:var(--color-destructive)]"
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <span className={t.passed ? "text-foreground" : "font-medium text-destructive"}>
                      {t.name}
                    </span>
                    {!t.passed && t.error && (
                      <pre className="mt-0.5 whitespace-pre-wrap break-all text-[11px] text-muted-foreground">
                        {t.error}
                      </pre>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
