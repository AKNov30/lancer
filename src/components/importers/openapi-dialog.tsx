import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { importOpenapi, type OpenApiImportReport } from "@/lib/tauri";
import { useWorkspace } from "@/stores/workspace-store";

export function OpenApiImportDialog() {
  const rootPath = useWorkspace((s) => s.rootPath);
  const refresh = useWorkspace((s) => s.refresh);

  const [open_, setOpen] = useState(false);
  const [specPath, setSpecPath] = useState<string | null>(null);
  const [destRoot, setDestRoot] = useState<string | null>(rootPath);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<OpenApiImportReport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Update destRoot when workspace changes.
  const effectiveDestRoot = destRoot ?? rootPath ?? "";

  async function pickSpecFile() {
    try {
      const picked = await open({
        multiple: false,
        filters: [{ name: "OpenAPI Spec", extensions: ["yaml", "yml", "json"] }],
      });
      if (typeof picked === "string") {
        setSpecPath(picked);
        setReport(null);
        setImportError(null);
      }
    } catch (e) {
      setImportError(String(e));
    }
  }

  async function pickDestFolder() {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === "string") {
        setDestRoot(picked);
        setReport(null);
        setImportError(null);
      }
    } catch (e) {
      setImportError(String(e));
    }
  }

  async function runImport() {
    if (!specPath || !effectiveDestRoot) return;
    setRunning(true);
    setReport(null);
    setImportError(null);
    try {
      const result = await importOpenapi(specPath, effectiveDestRoot);
      setReport(result);
      await refresh();
    } catch (e) {
      setImportError(String(e));
    } finally {
      setRunning(false);
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Reset state when closing.
      setSpecPath(null);
      setDestRoot(rootPath);
      setReport(null);
      setImportError(null);
      setRunning(false);
    }
  }

  const canImport = Boolean(specPath) && Boolean(effectiveDestRoot) && !running;

  return (
    <Dialog open={open_} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Import OpenAPI
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import OpenAPI Spec</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          {/* Spec file picker */}
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">OpenAPI file (.yaml / .json)</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void pickSpecFile()}>
                Pick file…
              </Button>
              {specPath && (
                <span className="min-w-0 truncate font-mono text-xs" title={specPath}>
                  {specPath.split(/[/\\]/).pop()}
                </span>
              )}
            </div>
          </div>

          {/* Destination folder picker */}
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">Destination folder</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void pickDestFolder()}>
                Pick folder…
              </Button>
              {effectiveDestRoot && (
                <span className="min-w-0 truncate font-mono text-xs" title={effectiveDestRoot}>
                  {effectiveDestRoot}
                </span>
              )}
            </div>
          </div>

          {/* Error */}
          {importError && (
            <p className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-xs">
              {importError}
            </p>
          )}

          {/* Report */}
          {report && (
            <div className="flex flex-col gap-2">
              {report.envCreated && (
                <p className="text-muted-foreground text-xs">
                  Environment:{" "}
                  <span className="font-mono">{report.envCreated.split(/[/\\]/).pop()}</span>
                </p>
              )}
              <div className="rounded border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-3 py-1.5 text-left font-medium">File</th>
                      <th className="px-3 py-1.5 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.createdFiles.map((f) => (
                      <tr key={f} className="border-b last:border-0">
                        <td className="px-3 py-1 font-mono">{f}</td>
                        <td className="px-3 py-1 text-green-600">created</td>
                      </tr>
                    ))}
                    {report.skippedExisting.map((f) => (
                      <tr key={f} className="border-b last:border-0">
                        <td className="px-3 py-1 font-mono">{f}</td>
                        <td className="px-3 py-1 text-muted-foreground">skipped</td>
                      </tr>
                    ))}
                    {report.errors.map((e) => (
                      <tr key={e} className="border-b last:border-0">
                        <td className="px-3 py-1 font-mono text-destructive" colSpan={2}>
                          {e}
                        </td>
                      </tr>
                    ))}
                    {report.createdFiles.length === 0 &&
                      report.skippedExisting.length === 0 &&
                      report.errors.length === 0 && (
                        <tr>
                          <td colSpan={2} className="px-3 py-1 text-center text-muted-foreground">
                            No operations found.
                          </td>
                        </tr>
                      )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => void runImport()} disabled={!canImport}>
            {running ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
