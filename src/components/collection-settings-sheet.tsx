import {
  CheckIcon,
  FolderIcon,
  KeyIcon,
  LibraryIcon,
  Loader2,
  LockIcon,
  SaveIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { CollectionAuthEditor } from "@/components/collection-auth-editor";
import { Button } from "@/components/ui/button";
import { KvTable } from "@/components/ui/kv-table";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { type FolderSettings, readFolderSettings, writeFolderSettings } from "@/lib/tauri";
import type { Auth, KvRow } from "@/lib/types";
import { useUi } from "@/stores/ui-store";
import { useWorkspace } from "@/stores/workspace-store";

/**
 * Collection (folder) settings panel — Postman's "click on a collection
 * shows tabs in the editor" UX, ported to a side Sheet so it doesn't fight
 * with the request editor for screen real-estate.
 *
 * Triggered by `open-collection-settings` action (sidebar folder context
 * menu, command palette, or the ⚙ icon next to a folder row).
 *
 * Tabs:
 *  - Overview: folder name + path + request count.
 *  - Variables: KV editor backed by `folder.bru`. Vars defined here cascade
 *    into requests inside this folder (and its sub-folders), layered below
 *    env vars in precedence.
 */
export function CollectionSettingsSheet() {
  const pendingAction = useUi((s) => s.pendingAction);
  const clearPendingAction = useUi((s) => s.clearPendingAction);
  const items = useWorkspace((s) => s.items);
  const rootPath = useWorkspace((s) => s.rootPath);

  const [open, setOpen] = useState(false);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [vars, setVars] = useState<KvRow[]>([]);
  const [description, setDescription] = useState("");
  const [auth, setAuthState] = useState<Auth>({ kind: "none" });
  const [savedFlash, setSavedFlash] = useState(false);

  // Open + load when palette/sidebar requests it. `applyLoaded` is a stable
  // local helper (only calls setState); intentionally excluded from deps.
  // biome-ignore lint/correctness/useExhaustiveDependencies: applyLoaded is a render-stable setter wrapper
  useEffect(() => {
    if (pendingAction?.type !== "open-collection-settings") return;
    const path = pendingAction.folderPath;
    clearPendingAction();
    setFolderPath(path);
    setOpen(true);
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const s = await readFolderSettings(path);
        applyLoaded(s);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [pendingAction, clearPendingAction]);

  function applyLoaded(s: FolderSettings) {
    setName(s.name);
    setVars(s.vars.map((v) => ({ enabled: v.enabled, key: v.key, value: v.value })));
    setDescription(s.description ?? "");
    setAuthState(s.auth ?? { kind: "none" });
  }

  async function save() {
    if (!folderPath) return;
    setLoading(true);
    setError(null);
    try {
      await writeFolderSettings(folderPath, {
        name,
        description,
        vars: vars
          .filter((v) => v.key.trim().length > 0)
          .map((v) => ({ enabled: v.enabled, key: v.key, value: v.value })),
        // `none` means "no default" → send null so the folder.bru omits auth.
        auth: auth.kind === "none" ? null : auth,
      });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const requestCount = folderPath
    ? items.filter(
        (it) =>
          it.kind === "file" &&
          (it.path.startsWith(folderPath + (folderPath.includes("\\") ? "\\" : "/")) ||
            it.path === folderPath),
      ).length
    : 0;

  const folderName = folderPath
    ? (folderPath.split(/[\\/]/).filter(Boolean).pop() ?? "collection")
    : "";

  // A folder whose parent IS the workspace root is a *collection* (Bruno/
  // Postman's top-level container); anything deeper is a nested *folder*.
  // Both carry vars/auth (intentional cascade) — only the wording differs.
  const isCollection =
    !!folderPath && !!rootPath && normalizePath(parentPath(folderPath)) === normalizePath(rootPath);
  const kindLabel = isCollection ? "Collection" : "Folder";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-[560px] sm:max-w-[560px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {isCollection ? (
              <LibraryIcon
                className="size-4 text-[color:var(--color-primary)]"
                strokeWidth={2}
                aria-hidden="true"
              />
            ) : (
              <FolderIcon
                className="size-4 text-[color:var(--color-warning)]"
                strokeWidth={1.75}
                aria-hidden="true"
              />
            )}
            <span>
              {folderName || `${kindLabel} settings`}
              <span className="ml-2 font-mono font-normal text-[10px] text-muted-foreground/70 uppercase tracking-[0.15em]">
                {kindLabel}
              </span>
            </span>
          </SheetTitle>
          <SheetDescription>
            {isCollection
              ? "A collection is a top-level container. Variables and auth defined here cascade to every folder and request inside it, layered below environment variables in precedence."
              : "Variables and auth defined on this folder cascade to every request in it (and its sub-folders), layered below environment variables in precedence."}
          </SheetDescription>
        </SheetHeader>

        <SheetBody>
          <Tabs defaultValue="variables" className="flex h-full min-h-0 flex-col">
            <TabsList variant="line" className="h-9 shrink-0 border-border border-b">
              <TabsTrigger value="overview" className="cursor-pointer gap-1.5">
                {isCollection ? (
                  <LibraryIcon className="size-3.5" strokeWidth={2} aria-hidden="true" />
                ) : (
                  <FolderIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                )}
                Overview
              </TabsTrigger>
              <TabsTrigger value="variables" className="cursor-pointer gap-1.5">
                <KeyIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                Variables
                {vars.filter((v) => v.enabled && v.key.trim()).length > 0 && (
                  <span className="ml-1 rounded-sm bg-primary/15 px-1 nums-tabular text-[10px] text-primary">
                    {vars.filter((v) => v.enabled && v.key.trim()).length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="auth" className="cursor-pointer gap-1.5">
                <LockIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                Authorization
                {auth.kind !== "none" && (
                  <span className="ml-1 rounded-sm bg-primary/15 px-1 text-[10px] text-primary">
                    {auth.kind}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent
              value="overview"
              className="flex-1 overflow-y-auto p-3 focus-visible:outline-none"
            >
              <div className="grid gap-3 text-sm">
                <Field label={`${kindLabel} name`}>
                  <p className="font-mono text-foreground">{folderName}</p>
                </Field>
                <Field label="Path">
                  <p className="break-all font-mono text-muted-foreground text-xs">{folderPath}</p>
                </Field>
                <Field label="Requests">
                  <p className="nums-tabular text-foreground">
                    {requestCount}{" "}
                    <span className="text-muted-foreground">
                      {requestCount === 1 ? "file" : "files"} (recursive)
                    </span>
                  </p>
                </Field>
                <Field label="Description">
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What this collection is for, conventions, auth notes… (markdown, saved to folder.bru)"
                    className="min-h-[120px] resize-y font-mono text-xs"
                  />
                </Field>
              </div>
            </TabsContent>

            <TabsContent
              value="variables"
              className="flex-1 overflow-y-auto p-3 focus-visible:outline-none"
            >
              <p className="mb-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-muted-foreground text-xs">
                {isCollection
                  ? "These cascade into every folder and request inside this collection — that's why nested folders can read them too (intentional inheritance). A nested folder or request can override any of them."
                  : "These cascade into every request in this folder and its sub-folders (intentional inheritance). A deeper folder or request can override any of them."}
              </p>
              {loading && vars.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-sm">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Loading…
                </div>
              ) : (
                <KvTable
                  rows={vars}
                  onChange={setVars}
                  keyPlaceholder="baseUrl"
                  valuePlaceholder="https://api.example.com"
                  hint="Use {{name}} inside any request in this folder to reference these values. Disabled rows stay in the file but aren't applied."
                />
              )}
            </TabsContent>

            <TabsContent
              value="auth"
              className="flex min-h-0 flex-1 flex-col focus-visible:outline-none"
            >
              <p className="px-3 pt-3 text-muted-foreground/70 text-xs">
                {isCollection
                  ? "Everything inside this collection that has no auth of its own inherits this — that's the intentional cascade. The nearest level wins: a nested folder or request overrides it."
                  : "Requests in this folder that have no auth of their own inherit this. The nearest level wins — a sub-folder's or request's auth overrides this one."}{" "}
                Use {"{{name}}"} to reference variables.
              </p>
              <div className="min-h-0 flex-1">
                <CollectionAuthEditor value={auth} onChange={setAuthState} />
              </div>
            </TabsContent>
          </Tabs>
        </SheetBody>

        {error && (
          <div className="mx-4 mb-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-xs">
            {error}
          </div>
        )}

        <SheetFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} className="cursor-pointer">
            Close
          </Button>
          <Button
            onClick={() => void save()}
            disabled={loading}
            className="cursor-pointer gap-1.5 disabled:cursor-not-allowed"
          >
            {savedFlash ? (
              <>
                <CheckIcon
                  className="size-3.5 text-[color:var(--color-success)]"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                Saved
              </>
            ) : loading ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : (
              <>
                <SaveIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                Save changes
              </>
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** Strip trailing separators and unify `\` → `/` so cross-platform path
 * comparison is robust (Windows roots arrive with backslashes). */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Parent directory of an absolute path (handles `/` and `\` separators). */
function parentPath(p: string): string {
  const norm = normalizePath(p);
  const idx = norm.lastIndexOf("/");
  return idx <= 0 ? norm : norm.slice(0, idx);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="font-mono font-semibold text-[10px] text-muted-foreground/70 tracking-[0.15em] uppercase">
        {label}
      </p>
      <div>{children}</div>
    </div>
  );
}
