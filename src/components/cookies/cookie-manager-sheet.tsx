import { CookieIcon, GlobeIcon, Loader2, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { type CookieInfo, clearCookies, deleteCookie, listCookies, setCookie } from "@/lib/tauri";
import { useUi } from "@/stores/ui-store";

interface DraftCookie {
  domain: string;
  name: string;
  value: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
}

const EMPTY_DRAFT: DraftCookie = {
  domain: "",
  name: "",
  value: "",
  path: "/",
  secure: false,
  httpOnly: false,
};

/**
 * Cookie manager — an editable view of the shared HTTP cookie jar.
 *
 * Opened via the `open-cookies` pending action (command palette, or the
 * "Manage cookie jar" button in the response viewer's Cookies tab). Lists
 * stored cookies grouped by domain, with per-row edit + delete, an add form,
 * and a destructive "Clear all" confirm (matching the history sheet pattern).
 */
export function CookieManagerSheet() {
  const pendingAction = useUi((s) => s.pendingAction);
  const clearPendingAction = useUi((s) => s.clearPendingAction);

  const [open, setOpen] = useState(false);
  const [cookies, setCookies] = useState<CookieInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The add/edit form. When `editing` is non-null we're updating an existing
  // cookie (its original key is used to delete-then-reinsert if it changed).
  const [draft, setDraft] = useState<DraftCookie>(EMPTY_DRAFT);
  const [editing, setEditing] = useState<{ domain: string; name: string; path: string } | null>(
    null,
  );

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setCookies(await listCookies());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  // Open + load when the command palette / response viewer requests it.
  // `refresh`/`resetForm` are render-stable local helpers (only call setState);
  // including them would re-fire the effect needlessly. Intentionally excluded.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh/resetForm are stable setter wrappers
  useEffect(() => {
    if (pendingAction?.type !== "open-cookies") return;
    clearPendingAction();
    setOpen(true);
    resetForm();
    void refresh();
  }, [pendingAction, clearPendingAction]);

  function resetForm() {
    setDraft(EMPTY_DRAFT);
    setEditing(null);
  }

  function startEdit(c: CookieInfo) {
    setEditing({ domain: c.domain, name: c.name, path: c.path });
    setDraft({
      domain: c.domain,
      name: c.name,
      value: c.value,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
    });
  }

  async function submit() {
    if (!draft.domain.trim() || !draft.name.trim()) {
      setError("Domain and name are required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // If the key (domain/name/path) changed while editing, remove the old
      // entry first so we don't leave a duplicate behind.
      if (
        editing &&
        (editing.domain !== draft.domain.trim() ||
          editing.name !== draft.name.trim() ||
          editing.path !== (draft.path.trim() || "/"))
      ) {
        await deleteCookie(editing.domain, editing.name, editing.path);
      }
      await setCookie(
        draft.domain.trim(),
        draft.name.trim(),
        draft.value,
        draft.path.trim() || "/",
        draft.secure,
        draft.httpOnly,
      );
      resetForm();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function remove(c: CookieInfo) {
    setLoading(true);
    setError(null);
    try {
      await deleteCookie(c.domain, c.name, c.path);
      if (editing && editing.domain === c.domain && editing.name === c.name) resetForm();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function clearAll() {
    setLoading(true);
    setError(null);
    try {
      await clearCookies();
      resetForm();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  // Group by domain for the list — one section header per host.
  const groups = useMemo(() => {
    const map = new Map<string, CookieInfo[]>();
    for (const c of cookies) {
      const arr = map.get(c.domain) ?? [];
      arr.push(c);
      map.set(c.domain, arr);
    }
    return Array.from(map.entries());
  }, [cookies]);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void refresh();
      }}
    >
      <SheetContent side="right" className="w-[560px] sm:max-w-[560px]">
        <SheetHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <SheetTitle className="flex items-center gap-2">
                <CookieIcon
                  className="size-4 text-[color:var(--color-primary)]"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                Cookie jar
              </SheetTitle>
              <SheetDescription>
                {cookies.length} {cookies.length === 1 ? "cookie" : "cookies"} · shared by every
                request
              </SheetDescription>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 cursor-pointer gap-1 px-2 text-destructive text-xs hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed"
                  disabled={cookies.length === 0}
                >
                  <Trash2Icon className="size-3" strokeWidth={1.75} aria-hidden="true" />
                  Clear all
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent size="sm">
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear all cookies?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes all {cookies.length} stored cookies from the jar. Requests will be
                    sent without them until new cookies are set. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    size="sm"
                    onClick={() => void clearAll()}
                  >
                    Clear all
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </SheetHeader>

        <SheetBody className="px-3">
          {/* ── Add / edit form ───────────────────────────────────────────── */}
          <div className="mb-4 rounded-md border border-border/60 bg-muted/20 p-3">
            <p className="mb-2 font-mono font-semibold text-[10px] text-muted-foreground/70 tracking-[0.15em] uppercase">
              {editing ? "Edit cookie" : "Add cookie"}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="cookie-domain" className="text-muted-foreground text-xs">
                  Domain
                </Label>
                <Input
                  id="cookie-domain"
                  value={draft.domain}
                  onChange={(e) => setDraft((d) => ({ ...d, domain: e.target.value }))}
                  placeholder="example.com"
                  className="h-8 font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cookie-path" className="text-muted-foreground text-xs">
                  Path
                </Label>
                <Input
                  id="cookie-path"
                  value={draft.path}
                  onChange={(e) => setDraft((d) => ({ ...d, path: e.target.value }))}
                  placeholder="/"
                  className="h-8 font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cookie-name" className="text-muted-foreground text-xs">
                  Name
                </Label>
                <Input
                  id="cookie-name"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="session"
                  className="h-8 font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cookie-value" className="text-muted-foreground text-xs">
                  Value
                </Label>
                <Input
                  id="cookie-value"
                  value={draft.value}
                  onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
                  placeholder="abc123"
                  className="h-8 font-mono text-xs"
                />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-4">
              <Label className="cursor-pointer gap-2 text-xs">
                <Switch
                  checked={draft.secure}
                  onCheckedChange={(v) => setDraft((d) => ({ ...d, secure: v }))}
                />
                Secure
              </Label>
              <Label className="cursor-pointer gap-2 text-xs">
                <Switch
                  checked={draft.httpOnly}
                  onCheckedChange={(v) => setDraft((d) => ({ ...d, httpOnly: v }))}
                />
                HttpOnly
              </Label>
              <div className="ml-auto flex items-center gap-2">
                {editing && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 cursor-pointer text-xs"
                    onClick={resetForm}
                  >
                    Cancel
                  </Button>
                )}
                <Button
                  size="sm"
                  className="h-8 cursor-pointer gap-1.5 text-xs disabled:cursor-not-allowed"
                  onClick={() => void submit()}
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <PlusIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                  )}
                  {editing ? "Save cookie" : "Add cookie"}
                </Button>
              </div>
            </div>
          </div>

          {error && (
            <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-xs">
              {error}
            </div>
          )}

          {/* ── Cookie list, grouped by domain ────────────────────────────── */}
          {loading && cookies.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Loading…
            </div>
          )}

          {!loading && cookies.length === 0 && (
            <div className="bg-mesh-primary flex flex-col items-center justify-center gap-2 py-16 text-center">
              <div className="grid size-12 place-items-center rounded-full bg-card shadow-sm ring-1 ring-border">
                <CookieIcon
                  className="size-5 text-muted-foreground/50"
                  strokeWidth={1.25}
                  aria-hidden="true"
                />
              </div>
              <p className="font-medium text-foreground text-sm">No cookies stored</p>
              <p className="max-w-[36ch] text-muted-foreground/70 text-xs">
                Cookies set by servers in responses appear here automatically. You can also add one
                manually with the form above.
              </p>
            </div>
          )}

          {groups.map(([domain, rows]) => (
            <div key={domain} className="mb-4">
              <h4 className="sticky top-0 z-10 -mx-3 mb-2 flex items-center gap-1.5 bg-background/80 px-3 py-1 font-mono font-semibold text-[10px] text-muted-foreground/70 tracking-[0.15em] uppercase backdrop-blur">
                <GlobeIcon className="size-3" strokeWidth={1.75} aria-hidden="true" />
                {domain}
                <span className="ml-auto nums-tabular text-muted-foreground/40">{rows.length}</span>
              </h4>
              <ul className="space-y-1.5">
                {rows.map((c) => (
                  <li
                    key={`${c.domain}|${c.path}|${c.name}`}
                    className="group flex items-start gap-2 rounded-md border border-border/60 bg-card/40 px-3 py-2 transition-colors hover:border-primary/40 hover:bg-card"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-mono font-semibold text-foreground text-xs">
                          {c.name}
                        </span>
                        {c.secure && (
                          <span className="rounded-sm bg-primary/15 px-1 text-[9px] text-primary uppercase tracking-wider">
                            secure
                          </span>
                        )}
                        {c.httpOnly && (
                          <span className="rounded-sm bg-muted px-1 text-[9px] text-muted-foreground uppercase tracking-wider">
                            httpOnly
                          </span>
                        )}
                      </div>
                      <p
                        className="truncate font-mono text-[11px] text-muted-foreground"
                        title={c.value}
                      >
                        {c.value || <span className="italic opacity-60">(empty)</span>}
                      </p>
                      <p className="font-mono text-[10px] text-muted-foreground/60">
                        path: {c.path}
                        {c.expires ? ` · expires ${c.expires}` : " · session"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => startEdit(c)}
                        className="grid size-6 cursor-pointer place-items-center rounded-sm text-muted-foreground/50 transition-colors hover:bg-accent hover:text-primary"
                        aria-label={`Edit cookie ${c.name}`}
                        title="Edit"
                      >
                        <PencilIcon className="size-3" strokeWidth={1.75} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(c)}
                        className="grid size-6 cursor-pointer place-items-center rounded-sm text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`Delete cookie ${c.name}`}
                        title="Delete"
                      >
                        <Trash2Icon className="size-3" strokeWidth={1.75} aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
