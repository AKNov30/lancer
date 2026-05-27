import { ChevronRightIcon, FileIcon, FolderIcon } from "lucide-react";
import { Fragment, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useTabs } from "@/stores/request-store";
import { useWorkspace } from "@/stores/workspace-store";

/**
 * Compact breadcrumb (≤24px tall) showing the active tab's path relative to
 * the workspace root. Each folder segment is clickable — it scrolls to and
 * highlights that folder in the sidebar tree.
 *
 * Rendered between the TabBar and the URL bar. Hidden when the tab has no
 * saved path (a scratch / "New request" tab).
 */
export function RequestBreadcrumb() {
  const rootPath = useWorkspace((s) => s.rootPath);
  const activeTab = useTabs((s) => s.tabs.find((t) => t.id === s.activeId) ?? null);

  const segments = useMemo(() => {
    if (!activeTab) return null;
    const path = activeTab.savedPath ?? activeTab.suggestedSaveDir;
    if (!path || !rootPath) return null;

    // Strip the workspace root prefix and split. Works for both Windows
    // (`\\`) and POSIX (`/`) separators because we test for either.
    const sep = path.includes("\\") ? "\\" : "/";
    const root = rootPath.replace(/[\\/]$/, "");
    let rel = path.startsWith(root) ? path.slice(root.length) : path;
    rel = rel.replace(/^[\\/]+/, "");
    if (!rel) return null;

    const parts = rel.split(/[\\/]/).filter(Boolean);
    const hasFile = activeTab.savedPath !== null;
    const lastIsFile = hasFile && parts[parts.length - 1].toLowerCase().endsWith(".bru");

    return parts.map((name, idx) => {
      const isLast = idx === parts.length - 1;
      const isFile = isLast && lastIsFile;
      // Strip `.bru` from the display name on the leaf
      const display = isFile ? name.replace(/\.bru$/i, "") : name;
      return { name: display, isFile, sep, idx };
    });
  }, [activeTab, rootPath]);

  if (!segments || segments.length === 0) return null;

  return (
    <nav
      aria-label="Request path"
      className="flex h-6 shrink-0 items-center gap-1 overflow-hidden border-border/50 border-b bg-card/40 px-3 font-mono text-[11px] text-muted-foreground"
    >
      <FolderIcon
        className="size-3 shrink-0 text-muted-foreground/60"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <span className="shrink-0 truncate text-muted-foreground/60">workspace</span>
      {segments.map((s) => (
        <Fragment key={s.idx}>
          <ChevronRightIcon
            className="size-3 shrink-0 text-muted-foreground/40"
            strokeWidth={2}
            aria-hidden="true"
          />
          <span
            className={cn(
              "flex shrink min-w-0 items-center gap-1 truncate",
              s.isFile && "font-semibold text-foreground",
            )}
            title={s.name}
          >
            {s.isFile ? (
              <FileIcon
                className="size-3 shrink-0 text-primary"
                strokeWidth={1.75}
                aria-hidden="true"
              />
            ) : null}
            <span className="truncate">{s.name}</span>
          </span>
        </Fragment>
      ))}
    </nav>
  );
}
