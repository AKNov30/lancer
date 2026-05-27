import { FolderPlusIcon, Loader2, SparklesIcon } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createNamedWorkspace, defaultWorkspaceRoot } from "@/lib/tauri";
import { useUi } from "@/stores/ui-store";
import { useWorkspace } from "@/stores/workspace-store";

/**
 * "New workspace" dialog — the user types a name and Lancer creates the
 * folder under `<Documents>/Lancer/<name>/` automatically. No file picker
 * involved. This is the friendlier path for users who want the app to
 * "just manage workspaces"; the existing "Open existing folder…" flow stays
 * available for advanced cases (Git repos, shared drives, etc.).
 */
export function NewWorkspaceDialog() {
  const pendingAction = useUi((s) => s.pendingAction);
  const clearPendingAction = useUi((s) => s.clearPendingAction);
  const setRootPath = useWorkspace((s) => s.setRootPath);
  const refresh = useWorkspace((s) => s.refresh);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [base, setBase] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Listen for the palette / menu action that opens this dialog. We also
  // refetch the base path each time so a freshly-installed app sees the
  // correct Documents location on the first try.
  useEffect(() => {
    if (pendingAction?.type !== "new-workspace") return;
    clearPendingAction();
    setName("");
    setError(null);
    setOpen(true);
    void defaultWorkspaceRoot()
      .then(setBase)
      .catch((e) => setError(String(e)));
  }, [pendingAction, clearPendingAction]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const target = await createNamedWorkspace(name.trim());
      setRootPath(target);
      // Wait a beat to actually load the (empty) workspace's items, then
      // close the dialog. This avoids a "0 requests" flash before the
      // sidebar settles.
      await refresh();
      setOpen(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  // Preview the destination path the user is about to create, so they know
  // exactly where the files live before they hit Create.
  const sep = base?.includes("\\") ? "\\" : "/";
  const preview = base ? `${base}${sep}${name.trim() || "<name>"}` : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SparklesIcon
              className="size-4 text-[color:var(--color-primary)]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            New workspace
          </DialogTitle>
          <DialogDescription>
            Lancer creates a folder for you under your Documents directory. You can move it later or
            push it to Git — your collections are always just files on disk.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="new-ws-name" className="text-xs">
            Workspace name
          </Label>
          <Input
            id="new-ws-name"
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
            }}
            placeholder="My API tests"
            className="h-9 text-sm"
            spellCheck={false}
          />
          {preview && (
            <p className="break-all font-mono text-[10px] text-muted-foreground">
              <span className="text-muted-foreground/60">will create at </span>
              {preview}
            </p>
          )}
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-xs">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void create()} disabled={busy || !name.trim()} className="gap-1.5">
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <FolderPlusIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            )}
            Create workspace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
