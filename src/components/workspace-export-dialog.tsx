import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { ArchiveIcon, FileTextIcon, FolderIcon, KeyIcon, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { workspaceToPostmanJson } from "@/lib/postman-export";
import { exportWorkspaceZip, listTopLevelFolders, saveBytes } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useUi } from "@/stores/ui-store";
import { useWorkspace } from "@/stores/workspace-store";

type ExportFormat = "zip" | "postman";

/**
 * Rich workspace export dialog. Solves the "move workspace between machines"
 * pain — since Lancer has no cloud sync, the user needs a portable bundle.
 *
 * Two formats:
 *  - **ZIP** (recommended for backup) — packs `.bru` + `folder.bru` + env
 *    files verbatim. Unzip on the new machine, "Open folder" → done. Lossless.
 *  - **Postman v2.1 JSON** — single combined collection for sharing with
 *    Postman users. Lossy: post-response captures, per-folder settings,
 *    binary file paths get serialised but Postman won't necessarily honour
 *    them on re-import.
 *
 * Checkbox list lets the user pick which top-level folders (collections) to
 * include + whether to bundle the `environments/` directory.
 */
export function WorkspaceExportDialog() {
  const pendingAction = useUi((s) => s.pendingAction);
  const clearPendingAction = useUi((s) => s.clearPendingAction);
  const rootPath = useWorkspace((s) => s.rootPath);
  const items = useWorkspace((s) => s.items);

  const [open, setOpen] = useState(false);
  const [allFolders, setAllFolders] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includeEnvs, setIncludeEnvs] = useState(true);
  const [format, setFormat] = useState<ExportFormat>("zip");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pendingAction?.type !== "export-workspace") return;
    clearPendingAction();
    setOpen(true);
    setStatus(null);
    setError(null);
  }, [pendingAction, clearPendingAction]);

  // Hydrate folder list when the dialog opens.
  useEffect(() => {
    if (!open || !rootPath) return;
    void (async () => {
      try {
        const list = await listTopLevelFolders(rootPath);
        setAllFolders(list);
        // Default: everything selected.
        setSelected(new Set(list));
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [open, rootPath]);

  function toggle(name: string) {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelected(next);
  }

  function toggleAll() {
    if (selected.size === allFolders.length) setSelected(new Set());
    else setSelected(new Set(allFolders));
  }

  const masterState: boolean | "indeterminate" =
    selected.size === 0 ? false : selected.size === allFolders.length ? true : "indeterminate";

  // Cheap stats so the user can see what they're packing.
  const stats = useMemo(() => {
    if (!rootPath) return { requests: 0 };
    let requests = 0;
    for (const it of items) {
      if (it.kind !== "file") continue;
      const top = it.relPath.replace(/\\/g, "/").split("/")[0];
      if (selected.has(top)) requests++;
    }
    return { requests };
  }, [items, selected, rootPath]);

  async function runExport() {
    if (!rootPath) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const wsName = rootPath.split(/[\\/]/).filter(Boolean).pop() ?? "workspace";
      const folders = Array.from(selected);

      if (format === "zip") {
        const target = await saveDialog({
          defaultPath: `${wsName}.lancer.zip`,
          filters: [{ name: "ZIP archive", extensions: ["zip"] }],
          title: "Save workspace bundle",
        });
        if (!target) {
          setBusy(false);
          return;
        }
        const report = await exportWorkspaceZip(rootPath, folders, includeEnvs, target);
        const { fileCount, redactedFiles } = report;
        const base = `Bundled ${fileCount} file${fileCount === 1 ? "" : "s"} into the archive.`;
        setStatus(
          redactedFiles > 0
            ? `${base} Redacted literal auth secrets in ${redactedFiles} file${redactedFiles === 1 ? "" : "s"}.`
            : base,
        );
      } else {
        // Postman v2.1: filter items down to the selected folders, then run
        // through the existing converter.
        const filtered = items.filter((it) => {
          if (it.kind !== "file") return false;
          const top = it.relPath.replace(/\\/g, "/").split("/")[0];
          return selected.has(top);
        });
        const json = await workspaceToPostmanJson(wsName, filtered);
        const target = await saveDialog({
          defaultPath: `${wsName}.postman_collection.json`,
          filters: [{ name: "Postman Collection", extensions: ["json"] }],
          title: "Save Postman v2.1 collection",
        });
        if (!target) {
          setBusy(false);
          return;
        }
        await saveBytes(target, Array.from(new TextEncoder().encode(json)));
        setStatus(`Exported ${stats.requests} request(s) as Postman v2.1 collection.`);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArchiveIcon className="size-4 text-primary" strokeWidth={1.75} aria-hidden="true" />
            Export workspace
          </DialogTitle>
          <DialogDescription>
            Move your collections to another machine, share with a teammate, or back them up.
            Workspaces are folders of <code className="font-mono">.bru</code> files — you can also
            just <strong>copy the folder</strong> or push it to Git.
          </DialogDescription>
        </DialogHeader>

        {/* Format selector */}
        <div className="grid grid-cols-2 gap-2">
          <FormatCard
            value="zip"
            current={format}
            onSelect={setFormat}
            icon={ArchiveIcon}
            title="ZIP archive"
            subtitle="Lossless · best for backup"
            hint="Unzip → Open folder → done"
          />
          <FormatCard
            value="postman"
            current={format}
            onSelect={setFormat}
            icon={FileTextIcon}
            title="Postman v2.1"
            subtitle="Lossy · share w/ Postman users"
            hint="Single JSON file"
          />
        </div>

        {/* Collection picker */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 border-border/60 border-b pb-1.5">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={masterState}
                onCheckedChange={toggleAll}
                aria-label="Toggle all collections"
              />
              <Label className="cursor-pointer font-mono font-semibold text-[10px] text-muted-foreground/70 tracking-[0.15em] uppercase">
                Collections{" "}
                <span className="text-muted-foreground/40">
                  {selected.size}/{allFolders.length}
                </span>
              </Label>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground/60 nums-tabular">
              ~{stats.requests} request{stats.requests === 1 ? "" : "s"}
            </span>
          </div>
          {allFolders.length === 0 ? (
            <p className="px-2 py-3 text-center text-muted-foreground text-xs">
              No top-level folders found. Create a folder in the sidebar first.
            </p>
          ) : (
            <ul className="max-h-48 space-y-1 overflow-y-auto pr-1">
              {allFolders.map((name) => (
                <li
                  key={name}
                  className="flex items-center gap-2 rounded-sm px-1 py-1 transition-colors hover:bg-accent/30"
                >
                  <Checkbox
                    checked={selected.has(name)}
                    onCheckedChange={() => toggle(name)}
                    aria-label={`Include ${name}`}
                  />
                  <FolderIcon
                    className="size-3.5 shrink-0 text-[color:var(--color-warning)]"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    onClick={() => toggle(name)}
                    className="min-w-0 flex-1 cursor-pointer truncate text-left font-mono text-xs"
                  >
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Envs toggle — only meaningful for ZIP (Postman v2.1 doesn't carry env files) */}
        {format === "zip" && (
          <div className="flex items-center gap-2 rounded-md border border-border/60 bg-card/40 px-3 py-2">
            <Checkbox
              id="include-envs"
              checked={includeEnvs}
              onCheckedChange={(v) => setIncludeEnvs(v === true)}
              aria-label="Include environments"
            />
            <Label
              htmlFor="include-envs"
              className="flex cursor-pointer items-center gap-1.5 text-xs"
            >
              <KeyIcon
                className="size-3.5 text-muted-foreground"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              Include <code className="font-mono">environments/</code> folder
              <span className="text-muted-foreground/60">(env files, not keyring secrets)</span>
            </Label>
          </div>
        )}

        {status && (
          <div className="rounded-md border border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/5 px-3 py-2 text-[color:var(--color-success)] text-xs">
            {status}
          </div>
        )}
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-xs">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Close
          </Button>
          <Button
            onClick={() => void runExport()}
            disabled={busy || selected.size === 0}
            className="gap-1.5"
          >
            {busy ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                Exporting…
              </>
            ) : (
              <>
                {format === "zip" ? (
                  <ArchiveIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                ) : (
                  <FileTextIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                )}
                Export
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormatCard({
  value,
  current,
  onSelect,
  icon: Icon,
  title,
  subtitle,
  hint,
}: {
  value: ExportFormat;
  current: ExportFormat;
  onSelect: (v: ExportFormat) => void;
  icon: typeof ArchiveIcon;
  title: string;
  subtitle: string;
  hint: string;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      aria-pressed={active}
      className={cn(
        "group flex cursor-pointer flex-col items-start gap-1 rounded-md border p-3 text-left transition-all duration-200",
        "hover:-translate-y-px hover:border-primary/50 hover:shadow-md active:scale-[0.98]",
        active
          ? "border-primary bg-primary/5 shadow-[var(--shadow-glow)]"
          : "border-border bg-card",
      )}
    >
      <Icon
        className={cn(
          "size-4 transition-transform duration-300 group-hover:scale-110",
          active ? "text-primary" : "text-muted-foreground",
        )}
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <div className="font-semibold text-sm">{title}</div>
      <div className="text-[10px] text-muted-foreground">{subtitle}</div>
      <div className="font-mono text-[10px] text-muted-foreground/60">{hint}</div>
    </button>
  );
}
