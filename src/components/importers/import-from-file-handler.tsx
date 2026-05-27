import { open as openFile } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { detectFileFormat, importOpenapi, importPostman, importPostmanEnv } from "@/lib/tauri";
import { useUi } from "@/stores/ui-store";
import { useWorkspace } from "@/stores/workspace-store";

type Status =
  | { phase: "idle" }
  | { phase: "detecting"; path: string }
  | { phase: "importing"; path: string; format: string }
  | { phase: "done"; format: string; message: string; warnings?: string[]; errors?: string[] }
  | { phase: "error"; message: string };

/**
 * Headless handler for the "Import from file…" command. Pops a native file
 * picker, sniffs the format, then routes to the matching Rust importer.
 *
 * Postman v2.1 collection / Postman env / OpenAPI (JSON or YAML) are all
 * accepted with no UI choice — the user just picks the file. cURL keeps its
 * own dialog because that flow is paste-text, not a file.
 */
export function ImportFromFileHandler() {
  const pendingAction = useUi((s) => s.pendingAction);
  const clearPendingAction = useUi((s) => s.clearPendingAction);
  const rootPath = useWorkspace((s) => s.rootPath);
  const refresh = useWorkspace((s) => s.refresh);

  const [status, setStatus] = useState<Status>({ phase: "idle" });

  // `runImport` is a render-recreated closure; intentionally excluded so the
  // effect only fires on a new pending action, not every render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runImport recreated each render by design
  useEffect(() => {
    if (pendingAction?.type !== "import-from-file") return;
    clearPendingAction();
    if (!rootPath) {
      setStatus({ phase: "error", message: "Open a workspace folder first." });
      return;
    }
    void runImport(rootPath);
  }, [pendingAction, rootPath, clearPendingAction]);

  async function runImport(workspaceRoot: string) {
    let picked: string | string[] | null = null;
    try {
      picked = await openFile({
        multiple: false,
        filters: [
          {
            name: "Collection / spec",
            extensions: ["json", "yaml", "yml"],
          },
        ],
        title: "Import collection or API spec",
      });
    } catch (e) {
      setStatus({ phase: "error", message: `File picker failed: ${String(e)}` });
      return;
    }
    if (typeof picked !== "string") return;

    setStatus({ phase: "detecting", path: picked });
    try {
      const format = await detectFileFormat(picked);
      if (format === "unknown") {
        setStatus({
          phase: "error",
          message:
            "Couldn't recognise this file. Lancer accepts Postman v2.1 collections, Postman environments, or OpenAPI / Swagger specs (JSON / YAML).",
        });
        return;
      }
      setStatus({ phase: "importing", path: picked, format });
      let message = "";
      let warnings: string[] | undefined;
      let errors: string[] | undefined;
      switch (format) {
        case "postman": {
          const r = await importPostman(picked, workspaceRoot);
          message = `Created ${r.created.length} request${r.created.length === 1 ? "" : "s"}${
            r.skippedExisting.length > 0
              ? ` · ${r.skippedExisting.length} skipped (already exist)`
              : ""
          }${r.errors.length > 0 ? ` · ${r.errors.length} errors` : ""}`;
          warnings = r.warnings.length > 0 ? r.warnings : undefined;
          errors = r.errors.length > 0 ? r.errors : undefined;
          break;
        }
        case "postman-env": {
          const envName = await importPostmanEnv(picked, workspaceRoot);
          message = `Imported environment "${envName}"`;
          break;
        }
        case "openapi": {
          const r = await importOpenapi(picked, workspaceRoot);
          message = `Created ${r.createdFiles.length} request${r.createdFiles.length === 1 ? "" : "s"}${
            r.envCreated ? ` · environment "${r.envCreated}"` : ""
          }${r.errors.length > 0 ? ` · ${r.errors.length} errors` : ""}`;
          errors = r.errors.length > 0 ? r.errors : undefined;
          break;
        }
        default:
          throw new Error(`Unhandled format: ${format}`);
      }
      await refresh();
      setStatus({ phase: "done", format, message, warnings, errors });
    } catch (e) {
      setStatus({ phase: "error", message: String(e) });
    }
  }

  const open = status.phase !== "idle";
  function close() {
    setStatus({ phase: "idle" });
  }

  const title =
    status.phase === "detecting"
      ? "Detecting format…"
      : status.phase === "importing"
        ? `Importing ${prettyFormat(status.format)}…`
        : status.phase === "done"
          ? `Imported ${prettyFormat(status.format)}`
          : status.phase === "error"
            ? "Import failed"
            : "Import";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Postman v2.1 collection, Postman environment, or OpenAPI / Swagger spec. Format is
            detected automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 text-sm">
          {status.phase === "detecting" && (
            <p className="font-mono break-all text-muted-foreground text-xs">{status.path}</p>
          )}
          {status.phase === "importing" && (
            <p className="text-muted-foreground">Reading and writing `.bru` files…</p>
          )}
          {status.phase === "done" && (
            <div className="space-y-2">
              <p
                className={
                  status.errors && status.errors.length > 0
                    ? "text-[color:var(--color-warning)]"
                    : "text-[color:var(--color-success)]"
                }
              >
                {status.message}
              </p>
              {status.warnings && status.warnings.length > 0 && (
                <details className="rounded-md border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/5 px-3 py-2 text-xs">
                  <summary className="cursor-pointer font-medium text-[color:var(--color-warning)]">
                    {status.warnings.length} warning
                    {status.warnings.length === 1 ? "" : "s"}
                  </summary>
                  <ul className="mt-2 list-inside list-disc space-y-1 font-mono text-[11px] text-muted-foreground">
                    {status.warnings.map((w) => (
                      <li key={w} className="break-all">
                        {w}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {status.errors && status.errors.length > 0 && (
                <details
                  open={status.errors.length <= 3}
                  className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs"
                >
                  <summary className="cursor-pointer font-medium text-destructive">
                    {status.errors.length} error
                    {status.errors.length === 1 ? "" : "s"} — click to expand
                  </summary>
                  <ul className="mt-2 list-inside list-disc space-y-1 font-mono text-[11px] text-muted-foreground">
                    {status.errors.map((err) => (
                      <li key={err} className="break-all">
                        {err}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {status.phase === "error" && <p className="text-destructive">{status.message}</p>}
        </div>

        <DialogFooter>
          <Button onClick={close} variant="outline" size="sm">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function prettyFormat(format: string): string {
  switch (format) {
    case "postman":
      return "Postman v2.1 collection";
    case "postman-env":
      return "Postman environment";
    case "openapi":
      return "OpenAPI / Swagger";
    default:
      return format;
  }
}
