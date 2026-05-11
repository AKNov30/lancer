import { open } from "@tauri-apps/plugin-dialog";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { importPostman, importPostmanEnv, type PostmanImportReport } from "@/lib/tauri";

interface PostmanDialogProps {
  /** Root folder of the destination Lancer workspace (collection + environments). */
  workspaceRoot: string;
  /** Called after a successful import so the sidebar can refresh. */
  onImported?: () => void;
  /** Optional trigger element; defaults to a "Import Postman" button. */
  children?: React.ReactNode;
}

type Phase = "idle" | "importing" | "done" | "error";

interface ReportState {
  report: PostmanImportReport | null;
  envName: string | null;
  error: string | null;
}

export function PostmanDialog({ workspaceRoot, onImported, children }: PostmanDialogProps) {
  const [open_, setOpen] = React.useState(false);
  const [collectionPath, setCollectionPath] = React.useState("");
  const [envPath, setEnvPath] = React.useState("");
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [result, setResult] = React.useState<ReportState>({
    report: null,
    envName: null,
    error: null,
  });

  function reset() {
    setCollectionPath("");
    setEnvPath("");
    setPhase("idle");
    setResult({ report: null, envName: null, error: null });
  }

  async function pickCollection() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Postman Collection", extensions: ["json"] }],
    });
    if (typeof selected === "string") setCollectionPath(selected);
  }

  async function pickEnv() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Postman Environment", extensions: ["json"] }],
    });
    if (typeof selected === "string") setEnvPath(selected);
  }

  async function handleImport() {
    if (!collectionPath) return;
    setPhase("importing");
    try {
      const report = await importPostman(collectionPath, workspaceRoot);

      let envName: string | null = null;
      if (envPath) {
        envName = await importPostmanEnv(envPath, workspaceRoot);
      }

      setResult({ report, envName, error: null });
      setPhase("done");
      onImported?.();
    } catch (err) {
      setResult({
        report: null,
        envName: null,
        error: err instanceof Error ? err.message : String(err),
      });
      setPhase("error");
    }
  }

  const canImport = collectionPath !== "" && phase === "idle";

  return (
    <Dialog
      open={open_}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        {children ?? <Button variant="outline">Import Postman</Button>}
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Postman Collection</DialogTitle>
          <DialogDescription>
            Select a Postman v2.1 collection JSON to import into this workspace. Optionally select
            an environment file to import alongside it.
          </DialogDescription>
        </DialogHeader>

        {phase !== "done" && phase !== "error" && (
          <div className="grid gap-4 py-4">
            {/* Collection picker */}
            <div className="grid gap-1.5">
              <Label htmlFor="collection-path">Collection JSON</Label>
              <div className="flex gap-2">
                <Input
                  id="collection-path"
                  readOnly
                  placeholder="No file selected"
                  value={collectionPath}
                  className="flex-1"
                />
                <Button type="button" variant="secondary" onClick={pickCollection}>
                  Browse
                </Button>
              </div>
            </div>

            {/* Env picker (optional) */}
            <div className="grid gap-1.5">
              <Label htmlFor="env-path">Environment JSON (optional)</Label>
              <div className="flex gap-2">
                <Input
                  id="env-path"
                  readOnly
                  placeholder="No file selected"
                  value={envPath}
                  className="flex-1"
                />
                <Button type="button" variant="secondary" onClick={pickEnv}>
                  Browse
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Done state */}
        {phase === "done" && result.report && (
          <div className="py-4 space-y-3 text-sm">
            <ImportSummaryRow label="Created" items={result.report.created} variant="success" />
            <ImportSummaryRow
              label="Skipped (already exist)"
              items={result.report.skippedExisting}
              variant="neutral"
            />
            {result.envName && (
              <p className="text-muted-foreground">
                Environment imported: <span className="font-medium">{result.envName}</span>
              </p>
            )}
            <ImportSummaryRow label="Warnings" items={result.report.warnings} variant="warning" />
            <ImportSummaryRow label="Errors" items={result.report.errors} variant="error" />
          </div>
        )}

        {/* Error state */}
        {phase === "error" && result.error && (
          <div className="py-4">
            <p className="text-sm text-destructive">{result.error}</p>
          </div>
        )}

        <DialogFooter>
          {phase === "done" || phase === "error" ? (
            <Button onClick={() => setOpen(false)}>Close</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleImport} disabled={!canImport}>
                {phase === "importing" ? "Importing…" : "Import"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Helper ──────────────────────────────────────────────────────────────────

interface SummaryRowProps {
  label: string;
  items: string[];
  variant: "success" | "neutral" | "warning" | "error";
}

function ImportSummaryRow({ label, items, variant }: SummaryRowProps) {
  if (items.length === 0) return null;
  const colorClass =
    variant === "success"
      ? "text-green-600 dark:text-green-400"
      : variant === "warning"
        ? "text-yellow-600 dark:text-yellow-400"
        : variant === "error"
          ? "text-destructive"
          : "text-muted-foreground";

  return (
    <div>
      <p className={`font-medium ${colorClass}`}>
        {label} ({items.length})
      </p>
      <ul className="mt-1 space-y-0.5 ml-3 list-disc text-xs text-muted-foreground max-h-32 overflow-y-auto">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
