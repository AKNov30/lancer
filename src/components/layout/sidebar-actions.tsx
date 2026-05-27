import { FilePlusIcon, FolderPlusIcon, LibraryIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

// ─── Rename dialog ───────────────────────────────────────────────────────────

interface RenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What kind of thing is being renamed (controls the dialog copy). */
  kind: "file" | "folder";
  currentName: string;
  /** Called with the new (raw, untrimmed) name when the user submits. */
  onSubmit: (newName: string) => Promise<void> | void;
}

export function RenameDialog({
  open,
  onOpenChange,
  kind,
  currentName,
  onSubmit,
}: RenameDialogProps) {
  const [value, setValue] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset state when the dialog opens with a fresh target.
  useEffect(() => {
    if (open) {
      setValue(currentName);
      setError(null);
      setBusy(false);
      // Auto-focus + select the stem so the user can type a new name immediately.
      setTimeout(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        const dot = currentName.lastIndexOf(".");
        if (kind === "file" && dot > 0) {
          el.setSelectionRange(0, dot);
        } else {
          el.select();
        }
      }, 0);
    }
  }, [open, currentName, kind]);

  async function commit() {
    if (busy) return;
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Name cannot be empty");
      return;
    }
    if (trimmed === currentName) {
      onOpenChange(false);
      return;
    }
    setBusy(true);
    try {
      await onSubmit(trimmed);
      onOpenChange(false);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PencilIcon
              className="size-4 text-muted-foreground"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            Rename {kind === "file" ? "request" : "folder"}
          </DialogTitle>
          <DialogDescription>
            Renames the {kind} on disk. Open tabs referencing this {kind} keep working.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="rename-input" className="text-xs">
            New name
          </Label>
          <Input
            id="rename-input"
            ref={inputRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commit();
            }}
            className="font-mono text-sm"
          />
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-destructive text-xs">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="cursor-pointer">
            Cancel
          </Button>
          <Button
            onClick={() => void commit()}
            disabled={busy}
            className="cursor-pointer disabled:cursor-not-allowed"
          >
            {busy ? "Renaming…" : "Rename"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create (new folder / new request name) dialog ───────────────────────────

interface CreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "folder" | "request";
  /** Parent folder absolute path — shown for context. */
  parentLabel: string;
  /** True when the parent is the workspace root: a `folder` created here is a
   * top-level *collection* (Bruno/Postman model), so wording switches to
   * "collection". Ignored for `request`. */
  topLevel?: boolean;
  /** Called with the trimmed new name. */
  onSubmit: (newName: string) => Promise<void> | void;
}

export function CreateDialog({
  open,
  onOpenChange,
  kind,
  parentLabel,
  topLevel = false,
  onSubmit,
}: CreateDialogProps) {
  // A folder at the workspace root is a "collection"; nested folders stay
  // "folder". Requests are always "request".
  const noun = kind === "folder" ? (topLevel ? "collection" : "folder") : "request";
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setValue("");
      setError(null);
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  async function commit() {
    if (busy) return;
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Name cannot be empty");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(trimmed);
      onOpenChange(false);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {noun === "collection" ? (
              <LibraryIcon
                className="size-4 text-[color:var(--color-primary)]"
                strokeWidth={2}
                aria-hidden="true"
              />
            ) : noun === "request" ? (
              <FilePlusIcon
                className="size-4 text-[color:var(--color-primary)]"
                strokeWidth={1.75}
                aria-hidden="true"
              />
            ) : (
              <FolderPlusIcon
                className="size-4 text-[color:var(--color-warning)]"
                strokeWidth={1.75}
                aria-hidden="true"
              />
            )}
            New {noun}
          </DialogTitle>
          <DialogDescription className="break-all font-mono text-xs">
            in: {parentLabel}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="create-input" className="text-xs">
            Name
          </Label>
          <Input
            id="create-input"
            ref={inputRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commit();
            }}
            placeholder={kind === "folder" ? "stripe-api" : "list-users"}
            className="font-mono text-sm"
          />
          <p className="text-muted-foreground/70 text-[11px]">
            {kind === "folder"
              ? topLevel
                ? "Top-level collection. Its variables & auth cascade to everything inside. Letters, numbers, dashes, dots, underscores."
                : "Nested folder. Inherits the parent collection's variables & auth (and can add its own). Letters, numbers, dashes, dots, underscores."
              : "Opens a new tab — edit your request, then Ctrl+S to save here as .bru."}
          </p>
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-destructive text-xs">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="cursor-pointer">
            Cancel
          </Button>
          <Button
            onClick={() => void commit()}
            disabled={busy}
            className="cursor-pointer disabled:cursor-not-allowed"
          >
            {busy ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete confirm dialog ───────────────────────────────────────────────────

interface DeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "file" | "folder";
  name: string;
  onConfirm: () => Promise<void> | void;
}

export function DeleteDialog({ open, onOpenChange, kind, name, onConfirm }: DeleteDialogProps) {
  const [busy, setBusy] = useState(false);

  async function doDelete() {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
            Delete {kind} &ldquo;{name}&rdquo;?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {kind === "folder" ? (
              <>
                This permanently deletes the folder and <strong>every file inside it</strong>. This
                action cannot be undone.
              </>
            ) : (
              <>This permanently deletes the request file. This action cannot be undone.</>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => void doDelete()}
            disabled={busy}
            className="cursor-pointer disabled:cursor-not-allowed"
          >
            {busy ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
