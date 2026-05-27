import { open } from "@tauri-apps/plugin-dialog";
import { FileJsonIcon, FolderOpenIcon } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { importOpenapi, type OpenApiImportReport } from "@/lib/tauri";
import { useWorkspace } from "@/stores/workspace-store";

interface OpenApiImportDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function OpenApiImportDialog({
  open: controlledOpen,
  onOpenChange,
}: OpenApiImportDialogProps = {}) {
  const rootPath = useWorkspace((s) => s.rootPath);
  const refresh = useWorkspace((s) => s.refresh);

  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open_ = isControlled ? controlledOpen : internalOpen;
  const setOpen = (v: boolean) => {
    if (isControlled) onOpenChange?.(v);
    else setInternalOpen(v);
  };
  const [specPath, setSpecPath] = useState<string | null>(null);
  const [destRoot, setDestRoot] = useState<string | null>(rootPath);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<OpenApiImportReport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

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
      {!isControlled && (
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 cursor-pointer gap-1.5 px-2 text-xs">
            <FileJsonIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            OpenAPI
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import OpenAPI spec</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Spec file picker */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">OpenAPI file (.yaml / .json)</Label>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void pickSpecFile()}
                className="cursor-pointer gap-1.5"
              >
                <FolderOpenIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                Pick file…
              </Button>
              {specPath && (
                <span
                  className="min-w-0 truncate font-mono text-muted-foreground text-xs"
                  title={specPath}
                >
                  {specPath.split(/[/\\]/).pop()}
                </span>
              )}
            </div>
          </div>

          {/* Destination folder picker */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Destination folder</Label>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void pickDestFolder()}
                className="cursor-pointer gap-1.5"
              >
                <FolderOpenIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                Pick folder…
              </Button>
              {effectiveDestRoot && (
                <span
                  className="min-w-0 truncate font-mono text-muted-foreground text-xs"
                  title={effectiveDestRoot}
                >
                  {effectiveDestRoot}
                </span>
              )}
            </div>
          </div>

          {/* Error */}
          {importError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
              <span className="font-medium text-destructive">Import failed:</span>
              <span className="break-all font-mono text-muted-foreground">{importError}</span>
            </div>
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
              <div className="rounded-md border">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-8 text-muted-foreground text-[10px] tracking-wider uppercase">
                        File
                      </TableHead>
                      <TableHead className="h-8 w-24 text-muted-foreground text-[10px] tracking-wider uppercase">
                        Status
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.createdFiles.map((f) => (
                      <TableRow key={f}>
                        <TableCell className="font-mono px-3 py-1">{f}</TableCell>
                        <TableCell
                          className="px-3 py-1 font-medium"
                          style={{ color: "var(--color-success)" }}
                        >
                          created
                        </TableCell>
                      </TableRow>
                    ))}
                    {report.skippedExisting.map((f) => (
                      <TableRow key={f}>
                        <TableCell className="font-mono px-3 py-1">{f}</TableCell>
                        <TableCell className="px-3 py-1 text-muted-foreground">skipped</TableCell>
                      </TableRow>
                    ))}
                    {report.errors.map((e) => (
                      <TableRow key={e}>
                        <TableCell
                          colSpan={2}
                          className="break-all px-3 py-1 font-mono text-destructive"
                        >
                          {e}
                        </TableCell>
                      </TableRow>
                    ))}
                    {report.createdFiles.length === 0 &&
                      report.skippedExisting.length === 0 &&
                      report.errors.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={2}
                            className="px-3 py-2 text-center text-muted-foreground"
                          >
                            No operations found.
                          </TableCell>
                        </TableRow>
                      )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void runImport()}
            disabled={!canImport}
            className="cursor-pointer disabled:cursor-not-allowed"
          >
            {running ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
