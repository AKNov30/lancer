import {
  ChevronDownIcon,
  ClockIcon,
  FolderOpenIcon,
  PencilIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useUi } from "@/stores/ui-store";
import { useWorkspace } from "@/stores/workspace-store";
import { leafName, useWorkspaces } from "@/stores/workspaces-store";

/**
 * Top-bar workspace switcher. Replaces the static path label with a clickable
 * pill that opens a recents dropdown.
 *
 * Layout:
 *   📂 [Friendly name or leaf folder] ▾
 *      └── dropdown ──────────────────────┐
 *           CURRENT
 *             ● {name}
 *               {path}
 *           RECENT (last N)
 *             {name} · path
 *             …
 *           ─────
 *           ✏ Rename current…
 *           📁 Open folder…
 *
 * The "Rename" inline editor sets a friendly name on the current path so
 * subsequent dropdowns show "Acme client API" instead of `D:\…\acme-client`.
 */
export function WorkspaceSwitcher() {
  const rootPath = useWorkspace((s) => s.rootPath);
  const openFolder = useWorkspace((s) => s.openFolder);
  const setRootPath = useWorkspace((s) => s.setRootPath);
  const refresh = useWorkspace((s) => s.refresh);

  const recent = useWorkspaces((s) => s.recent);
  const removeRecent = useWorkspaces((s) => s.remove);
  const renameRecent = useWorkspaces((s) => s.rename);
  const requestAction = useUi((s) => s.requestAction);

  const [renameOpen, setRenameOpen] = useState(false);
  const [draftName, setDraftName] = useState("");

  // No workspace yet — nothing to switch from. Hide the chip entirely; the
  // sidebar empty-state already exposes "Open folder".
  if (!rootPath) return null;
  // Narrow for the rest of the component — TS doesn't propagate the guard
  // into closures otherwise.
  const activePath: string = rootPath;

  const currentEntry = recent.find((w) => w.path.toLowerCase() === activePath.toLowerCase());
  const displayName = currentEntry?.name?.trim() || leafName(activePath);

  const otherRecent = recent
    .filter((w) => w.path.toLowerCase() !== activePath.toLowerCase())
    .slice(0, 8);

  function switchTo(path: string) {
    setRootPath(path);
    // setRootPath only stores — the items list still reflects the old
    // workspace until we refresh. Triggering it here keeps the sidebar
    // in sync the moment the dropdown closes.
    void refresh();
  }

  function startRename() {
    setDraftName(currentEntry?.name ?? "");
    setRenameOpen(true);
  }

  function commitRename() {
    renameRecent(activePath, draftName);
    setRenameOpen(false);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex max-w-[260px] cursor-pointer items-center gap-1.5 rounded-md border border-transparent",
              "px-2 py-0.5 text-xs transition-all duration-150",
              "hover:border-border hover:bg-accent/60",
              "data-[state=open]:border-border data-[state=open]:bg-accent/60",
            )}
            title={`Workspace: ${activePath} — click to switch`}
            aria-label="Switch workspace"
          >
            <FolderOpenIcon
              className="size-3.5 shrink-0 text-[color:var(--color-warning)]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <span className="min-w-0 truncate font-medium text-foreground">{displayName}</span>
            <ChevronDownIcon
              className="size-3 shrink-0 text-muted-foreground/60"
              strokeWidth={2}
              aria-hidden="true"
            />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="min-w-[340px]">
          <DropdownMenuLabel className="font-mono font-semibold text-[10px] text-muted-foreground/70 tracking-[0.15em] uppercase">
            Current
          </DropdownMenuLabel>
          <div className="px-2 py-1.5">
            <div className="flex items-center gap-2 font-medium text-foreground text-sm">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-[color:var(--color-success)]"
              />
              {displayName}
            </div>
            <div
              className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground"
              title={activePath}
            >
              {activePath}
            </div>
          </div>

          {otherRecent.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="font-mono font-semibold text-[10px] text-muted-foreground/70 tracking-[0.15em] uppercase">
                Recent
              </DropdownMenuLabel>
              {otherRecent.map((w) => {
                const name = w.name?.trim() || leafName(w.path);
                return (
                  <DropdownMenuItem
                    key={w.path}
                    className="group/recent flex cursor-pointer items-center gap-2 px-2 py-1.5"
                    onSelect={() => switchTo(w.path)}
                  >
                    <ClockIcon
                      className="size-3.5 shrink-0 text-muted-foreground"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-xs">{name}</div>
                      <div
                        className="truncate font-mono text-[10px] text-muted-foreground/70"
                        title={w.path}
                      >
                        {w.path}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        removeRecent(w.path);
                      }}
                      className="grid size-5 cursor-pointer place-items-center rounded-sm text-muted-foreground/40 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover/recent:opacity-100"
                      aria-label={`Remove ${name} from recent`}
                      title="Remove from recent"
                    >
                      <XIcon className="size-3" strokeWidth={2} aria-hidden="true" />
                    </button>
                  </DropdownMenuItem>
                );
              })}
            </>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="cursor-pointer gap-2"
            onSelect={() => requestAction({ type: "new-workspace" })}
          >
            <SparklesIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            New workspace…
            <span className="ml-auto text-[10px] text-muted-foreground">just a name</span>
          </DropdownMenuItem>
          <DropdownMenuItem className="cursor-pointer gap-2" onSelect={() => void openFolder()}>
            <FolderOpenIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            Open existing folder…
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">Ctrl+O</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer gap-2"
            onSelect={(e) => {
              e.preventDefault();
              startRename();
            }}
          >
            <PencilIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            Rename this workspace…
          </DropdownMenuItem>
          {currentEntry && (
            <DropdownMenuItem
              variant="destructive"
              className="cursor-pointer gap-2"
              onSelect={() => removeRecent(activePath)}
            >
              <Trash2Icon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
              Forget this workspace
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Inline rename popover — kept simple as a small fixed-position card */}
      {renameOpen && (
        <div
          className="fade-in-0 zoom-in-95 fixed top-12 left-32 z-50 w-72 animate-in rounded-md border border-border bg-popover p-3 shadow-md"
          role="dialog"
        >
          <p className="mb-2 font-medium text-xs">Workspace display name</p>
          <Input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder={leafName(activePath)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              else if (e.key === "Escape") setRenameOpen(false);
            }}
            className="h-7 text-xs"
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setRenameOpen(false)}
              className="cursor-pointer rounded-sm px-2 py-1 text-muted-foreground text-xs hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={commitRename}
              className="cursor-pointer rounded-sm bg-primary px-2 py-1 text-primary-foreground text-xs hover:bg-primary/90"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </>
  );
}
