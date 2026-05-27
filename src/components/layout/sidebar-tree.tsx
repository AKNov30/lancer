import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  ChevronRightIcon,
  CopyIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  KeyIcon,
  LibraryIcon,
  PencilIcon,
  PlayIcon,
  TerminalIcon,
  Trash2Icon,
} from "lucide-react";
import { useMemo } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { METHOD_COLOR } from "@/lib/method-color";
import type { WorkspaceItem } from "@/lib/tauri";
import { isMethod, type Method } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useTree } from "@/stores/tree-store";
import { useUi } from "@/stores/ui-store";

/**
 * Internal tree node. Folders are collapsible groups; files are leaf
 * {@link WorkspaceItem}s the user can click to open in a tab.
 */
type TreeNode =
  | {
      kind: "folder";
      name: string;
      /** Display path used as identifier for collapsed-state tracking */
      path: string;
      children: TreeNode[];
    }
  | { kind: "file"; item: WorkspaceItem };

/**
 * Build a hierarchy from a flat list of `WorkspaceItem`s using each item's
 * `relPath` (forward-slash separated). Order: folders sorted alphabetically
 * before files at every depth.
 */
function buildTree(items: WorkspaceItem[]): TreeNode[] {
  const root: TreeNode[] = [];

  function ensureFolder(parts: string[]): TreeNode[] {
    let cursor = root;
    let pathSoFar = "";
    for (const segment of parts) {
      pathSoFar = pathSoFar ? `${pathSoFar}/${segment}` : segment;
      let folder = cursor.find(
        (n): n is Extract<TreeNode, { kind: "folder" }> =>
          n.kind === "folder" && n.name === segment,
      );
      if (!folder) {
        folder = { kind: "folder", name: segment, path: pathSoFar, children: [] };
        cursor.push(folder);
      }
      cursor = folder.children;
    }
    return cursor;
  }

  function insert(item: WorkspaceItem) {
    // Normalize separators (Windows paths may carry `\`).
    const parts = item.relPath.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length === 0) return;

    if (item.kind === "folder") {
      // Folder rows from Rust just need to materialize the folder node — the
      // ensureFolder walk creates it if absent and reuses it otherwise, so
      // empty user-created folders show up alongside ones implied by files.
      ensureFolder(parts);
      return;
    }

    // File: parent path becomes folder(s), leaf becomes file node.
    const parentParts = parts.slice(0, -1);
    const cursor = ensureFolder(parentParts);
    cursor.push({ kind: "file", item });
  }

  for (const it of items) insert(it);

  // Sort folders before files alphabetically at each level.
  function sort(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      const an = a.kind === "folder" ? a.name : a.item.name;
      const bn = b.kind === "folder" ? b.name : b.item.name;
      return an.localeCompare(bn);
    });
    for (const n of nodes) {
      if (n.kind === "folder") sort(n.children);
    }
  }
  sort(root);
  return root;
}

/**
 * Action callbacks for the right-click context menu. The Sidebar component
 * owns the dialog state and Rust command calls; SidebarTree just emits.
 */
export interface SidebarTreeActions {
  /** A workspace root has been computed for path resolution. Folder nodes
      include their relative `path` (e.g. "github/v2"); files include their
      absolute `path`. */
  workspaceRoot: string;
  onNewRequest: (folderAbsPath: string) => void;
  onNewFolder: (folderAbsPath: string) => void;
  onRenameFile: (item: WorkspaceItem) => void;
  onRenameFolder: (folderAbsPath: string, folderName: string) => void;
  onDeleteFile: (item: WorkspaceItem) => void;
  onDeleteFolder: (folderAbsPath: string, folderName: string) => void;
  /** Extra right-click actions modelled after Postman's row context menu. */
  onDuplicateFile: (item: WorkspaceItem) => void | Promise<void>;
  onDuplicateFolder: (folderAbsPath: string) => void | Promise<void>;
  onCopyAsCurl: (item: WorkspaceItem) => void | Promise<void>;
  onRevealFile: (item: WorkspaceItem) => void | Promise<void>;
  onRevealFolder: (folderAbsPath: string) => void | Promise<void>;
}

interface SidebarTreeProps {
  items: WorkspaceItem[];
  activePath: string | null;
  onSelect: (item: WorkspaceItem) => void;
  actions: SidebarTreeActions;
}

export function SidebarTree({ items, activePath, onSelect, actions }: SidebarTreeProps) {
  const tree = useMemo(() => buildTree(items), [items]);
  return (
    <ul className="px-1 pb-2">
      {tree.map((node, idx) => (
        <TreeNodeRow
          key={node.kind === "folder" ? `f:${node.path}` : `r:${node.item.path}`}
          node={node}
          depth={0}
          orderIdx={idx}
          activePath={activePath}
          onSelect={onSelect}
          actions={actions}
        />
      ))}
    </ul>
  );
}

interface RowProps {
  node: TreeNode;
  depth: number;
  /** Sibling index for stagger animation */
  orderIdx: number;
  activePath: string | null;
  onSelect: (item: WorkspaceItem) => void;
  actions: SidebarTreeActions;
}

/** Join a workspace root with a relative folder path using forward slashes. */
function joinRoot(root: string, rel: string): string {
  const r = root.replace(/[/\\]+$/, "");
  // Pick the separator from the root so we don't mix `/` and `\` on Windows.
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${r}${sep}${rel.replace(/\//g, sep)}`;
}

function TreeNodeRow({ node, depth, orderIdx, activePath, onSelect, actions }: RowProps) {
  // Expand state is owned by the persisted tree-store (keyed by folder path)
  // so it survives file-watcher refreshes and app restarts, and defaults to
  // "top-level open, nested collapsed" rather than "everything open".
  const folderPath = node.kind === "folder" ? node.path : "";
  const open = useTree((s) => (node.kind === "folder" ? s.isOpen(folderPath, depth) : false));
  const setOpen = useTree((s) => s.set);

  if (node.kind === "folder") {
    const folderAbsPath = joinRoot(actions.workspaceRoot, node.path);
    // A folder directly under the workspace root is a *collection* (Bruno/
    // Postman's top-level container). Give it a distinct identity vs nested
    // folders so the hierarchy reads clearly.
    const isCollection = depth === 0;
    return (
      <FolderDropTarget folderAbsPath={folderAbsPath}>
        {(setNodeRef, isOver) => (
          <li ref={setNodeRef}>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <button
                  type="button"
                  onClick={() => setOpen(folderPath, !open)}
                  className={cn(
                    "group/folder flex w-full cursor-pointer items-center gap-1.5 rounded-sm py-1 pr-2 text-left text-xs",
                    "transition-colors duration-150",
                    "hover:bg-accent/40",
                    isOver && "bg-primary/15 ring-1 ring-primary/40 ring-inset",
                    "fade-in-0 slide-in-from-left-1 animate-in",
                  )}
                  style={{
                    paddingLeft: `${0.5 + depth * 0.75}rem`,
                    animationDelay: `${Math.min(orderIdx, 12) * 20}ms`,
                  }}
                  aria-expanded={open}
                >
                  <ChevronRightIcon
                    className={cn(
                      "size-3 shrink-0 text-muted-foreground/60 transition-transform duration-150",
                      open && "rotate-90",
                    )}
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  {isCollection ? (
                    <LibraryIcon
                      className="size-3.5 shrink-0 text-[color:var(--color-primary)]"
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                  ) : open ? (
                    <FolderOpenIcon
                      className="size-3.5 shrink-0 text-[color:var(--color-warning)]"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  ) : (
                    <FolderIcon
                      className="size-3.5 shrink-0 text-[color:var(--color-warning)]"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  )}
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate font-mono",
                      isCollection ? "font-semibold text-foreground" : "font-medium",
                    )}
                  >
                    {node.name}
                  </span>
                  <span className="nums-tabular text-muted-foreground/50 text-[10px]">
                    {countFiles(node)}
                  </span>
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem
                  className="gap-2"
                  onSelect={() => actions.onNewRequest(folderAbsPath)}
                >
                  <FilePlusIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                  New request here
                </ContextMenuItem>
                <ContextMenuItem
                  className="gap-2"
                  onSelect={() => actions.onNewFolder(folderAbsPath)}
                >
                  <FolderPlusIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                  New folder
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  className="gap-2"
                  onSelect={() =>
                    useUi
                      .getState()
                      .requestAction({ type: "run-folder", folderPath: folderAbsPath })
                  }
                >
                  <PlayIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                  Run folder…
                </ContextMenuItem>
                <ContextMenuItem
                  className="gap-2"
                  onSelect={() =>
                    useUi
                      .getState()
                      .requestAction({ type: "export-postman-folder", folderPath: folderAbsPath })
                  }
                >
                  <FileTextIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                  Export folder as Postman v2.1…
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  className="gap-2"
                  onSelect={() =>
                    useUi.getState().requestAction({
                      type: "open-collection-settings",
                      folderPath: folderAbsPath,
                    })
                  }
                >
                  <KeyIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                  Variables & settings…
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  className="gap-2"
                  onSelect={() => actions.onRenameFolder(folderAbsPath, node.name)}
                >
                  <PencilIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                  Rename folder
                </ContextMenuItem>
                <ContextMenuItem
                  className="gap-2"
                  onSelect={() => void actions.onDuplicateFolder(folderAbsPath)}
                >
                  <CopyIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                  Duplicate folder
                </ContextMenuItem>
                <ContextMenuItem
                  className="gap-2"
                  onSelect={() => void actions.onRevealFolder(folderAbsPath)}
                >
                  <FolderOpenIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                  Show in file explorer
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  variant="destructive"
                  className="gap-2"
                  onSelect={() => actions.onDeleteFolder(folderAbsPath, node.name)}
                >
                  <Trash2Icon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                  Delete folder
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
            {open && (
              <ul className="flex flex-col">
                {node.children.map((child, idx) => (
                  <TreeNodeRow
                    key={child.kind === "folder" ? `f:${child.path}` : `r:${child.item.path}`}
                    node={child}
                    depth={depth + 1}
                    orderIdx={idx}
                    activePath={activePath}
                    onSelect={onSelect}
                    actions={actions}
                  />
                ))}
              </ul>
            )}
          </li>
        )}
      </FolderDropTarget>
    );
  }

  // File leaf
  const it = node.item;
  return (
    <FileDraggableRow
      item={it}
      depth={depth}
      orderIdx={orderIdx}
      activePath={activePath}
      onSelect={onSelect}
      actions={actions}
    />
  );
}

interface FileRowProps {
  item: WorkspaceItem;
  depth: number;
  orderIdx: number;
  activePath: string | null;
  onSelect: (item: WorkspaceItem) => void;
  actions: SidebarTreeActions;
}

function FolderDropTarget({
  folderAbsPath,
  children,
}: {
  folderAbsPath: string;
  children: (setNodeRef: (el: HTMLLIElement | null) => void, isOver: boolean) => React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `folder:${folderAbsPath}`,
    data: { type: "folder", path: folderAbsPath },
  });
  return <>{children(setNodeRef, isOver)}</>;
}

function FileDraggableRow({ item, depth, orderIdx, activePath, onSelect, actions }: FileRowProps) {
  const it = item;
  const isActive = activePath === it.path;
  const m: Method = isMethod(it.method) ? it.method : "GET";
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `file:${it.path}`,
    data: { type: "file", path: it.path },
  });
  return (
    <li ref={setNodeRef} style={{ opacity: isDragging ? 0.4 : 1 }}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            onClick={() => onSelect(it)}
            data-active={isActive}
            {...attributes}
            {...listeners}
            className={cn(
              "group/item relative flex w-full cursor-pointer items-center gap-2 rounded-sm py-1 pr-2 text-left",
              "transition-all duration-150 ease-out",
              "hover:bg-accent/60 focus-visible:bg-accent",
              "data-[active=true]:bg-accent",
              "fade-in-0 slide-in-from-left-1 animate-in",
            )}
            style={{
              paddingLeft: `${0.5 + depth * 0.75}rem`,
              animationDelay: `${Math.min(orderIdx, 12) * 20}ms`,
            }}
          >
            {/* Active indicator — left bar */}
            <span
              aria-hidden="true"
              className={cn(
                "absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary",
                "scale-y-0 transition-transform duration-150",
                "group-data-[active=true]/item:scale-y-100",
              )}
              style={{ left: `${0.25 + depth * 0.75}rem` }}
            />
            {/* Method label — plain colored text (Postman/Bruno style), no
                heavy pill. Keeps the request NAME as the primary element. */}
            <span
              className="w-[34px] shrink-0 text-right font-mono font-semibold text-[10px] uppercase tracking-wide nums-tabular"
              style={{ color: METHOD_COLOR[m] }}
            >
              {m === "OPTIONS" ? "OPT" : m === "DELETE" ? "DEL" : m}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs">{it.name}</span>
            <ChevronRightIcon
              className="size-3 shrink-0 text-muted-foreground/0 transition-all duration-150 group-hover/item:translate-x-0.5 group-hover/item:text-muted-foreground/70"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem className="gap-2" onSelect={() => onSelect(it)}>
            <ChevronRightIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            Open
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem className="gap-2" onSelect={() => void actions.onDuplicateFile(it)}>
            <CopyIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            Duplicate
          </ContextMenuItem>
          <ContextMenuItem className="gap-2" onSelect={() => void actions.onCopyAsCurl(it)}>
            <TerminalIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            Copy as cURL
          </ContextMenuItem>
          <ContextMenuItem className="gap-2" onSelect={() => actions.onRenameFile(it)}>
            <PencilIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            Rename
          </ContextMenuItem>
          <ContextMenuItem className="gap-2" onSelect={() => void actions.onRevealFile(it)}>
            <FolderOpenIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            Show in file explorer
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            className="gap-2"
            onSelect={() => actions.onDeleteFile(it)}
          >
            <Trash2Icon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </li>
  );
}

function countFiles(node: TreeNode): number {
  if (node.kind === "file") return 1;
  return node.children.reduce((acc, c) => acc + countFiles(c), 0);
}
