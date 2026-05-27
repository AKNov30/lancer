import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  FileIcon,
  FilePlusIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { requestFromCollection } from "@/lib/collection-convert";
import { methodColor } from "@/lib/method-color";
import { revealInFileManager } from "@/lib/reveal-in-file-manager";
import {
  createFolder,
  deletePath,
  duplicatePath,
  exportCurl,
  moveItem,
  readRequest,
  renamePath,
  type WorkspaceItem,
} from "@/lib/tauri";
import { bodyToWire, isMethod, kvRowsToTuples, type Method } from "@/lib/types";
import {
  ACT,
  CREATE_ACTIONS,
  IMPORT_ACTIONS,
  runWorkspaceAction,
  type WorkspaceActionCtx,
  type WorkspaceActionDef,
} from "@/lib/workspace-actions";
import { useTabs } from "@/stores/request-store";
import { useTree } from "@/stores/tree-store";
import { useUi } from "@/stores/ui-store";
import { useWorkspace } from "@/stores/workspace-store";
import { leafName, useWorkspaces } from "@/stores/workspaces-store";
import { CreateDialog, DeleteDialog, RenameDialog } from "./sidebar-actions";
import { SidebarHeader } from "./sidebar-header";
import { SidebarTree, type SidebarTreeActions } from "./sidebar-tree";

/** Unify `\` → `/` and drop trailing separators for robust path comparison
 * (Windows workspace roots arrive with backslashes). */
function normalizeForCompare(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function Sidebar() {
  const rootPath = useWorkspace((s) => s.rootPath);
  const items = useWorkspace((s) => s.items);
  const loading = useWorkspace((s) => s.loading);
  const error = useWorkspace((s) => s.error);
  const openFolder = useWorkspace((s) => s.openFolder);
  const refresh = useWorkspace((s) => s.refresh);

  const bulkMode = useTree((s) => s.bulkMode);
  const requestAction = useUi((s) => s.requestAction);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  // Shared context + renderer so the right-click menu renders from the SAME
  // descriptors as the "+ Add" dropdown and palette (no label/icon drift).
  const wsActionCtx: WorkspaceActionCtx = {
    rootPath: rootPath ?? "",
    requestAction,
    setPaletteOpen,
    refresh: () => void refresh(),
  };
  const renderCtxItem = (def: WorkspaceActionDef) => {
    const Icon = def.Icon;
    return (
      <ContextMenuItem
        key={def.id}
        className="gap-2"
        onSelect={() => runWorkspaceAction(def.id, wsActionCtx)}
      >
        <Icon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
        {def.label}
        {def.hint && (
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">{def.hint}</span>
        )}
      </ContextMenuItem>
    );
  };

  const openInTab = useTabs((s) => s.openInTab);
  const newTab = useTabs((s) => s.newTab);
  const retargetSavedPath = useTabs((s) => s.retargetSavedPath);

  const [activePath, setActivePath] = useState<string | null>(null);

  // dnd-kit sensors: 4px activation distance prevents accidental drags when
  // the user just wants to click a request row to open it.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // The DragOverlay needs to know which item is being dragged so it can
  // render the floating ghost. Method colour comes along for the badge.
  const [activeDrag, setActiveDrag] = useState<{ name: string; method: string } | null>(null);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const path = event.active.data.current?.path as string | undefined;
      if (!path) return;
      const item = items.find((it) => it.path === path);
      if (item) {
        setActiveDrag({ name: item.name, method: item.method });
        // Hint the cursor while dragging — system "grabbing" beats the
        // browser's default "auto" that dnd-kit leaves alone.
        document.body.style.cursor = "grabbing";
      }
    },
    [items],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveDrag(null);
      document.body.style.cursor = "";
      const fromPath = event.active.data.current?.path as string | undefined;
      const toParent = event.over?.data.current?.path as string | undefined;
      if (!fromPath || !toParent) return;

      // No-op if dropped on its current parent folder.
      const sep = fromPath.includes("\\") ? "\\" : "/";
      const currentParent = fromPath.slice(0, fromPath.lastIndexOf(sep));
      if (currentParent === toParent) return;

      try {
        const newPath = await moveItem(fromPath, toParent);
        retargetSavedPath(fromPath, newPath);
        setActivePath((prev) => (prev === fromPath ? newPath : prev));
        await refresh();
      } catch (e) {
        console.error("move_item failed", e);
      }
    },
    [refresh, retargetSavedPath],
  );

  // Action dialog state — only one is open at a time. `target` carries the
  // path + name + kind for the operation.
  const [renameTarget, setRenameTarget] = useState<{
    path: string;
    name: string;
    kind: "file" | "folder";
  } | null>(null);
  const [createTarget, setCreateTarget] = useState<{
    parentPath: string;
    kind: "folder" | "request";
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    path: string;
    name: string;
    kind: "file" | "folder";
  } | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Command palette → Sidebar bridge. The palette dispatches `pendingAction`
  // and we react by opening the right dialog or running the right command.
  const pendingAction = useUi((s) => s.pendingAction);
  const clearPendingAction = useUi((s) => s.clearPendingAction);
  useEffect(() => {
    if (!pendingAction) return;
    if (pendingAction.type === "new-request") {
      setCreateTarget({ parentPath: pendingAction.parentPath, kind: "request" });
      clearPendingAction();
    } else if (pendingAction.type === "new-folder") {
      setCreateTarget({ parentPath: pendingAction.parentPath, kind: "folder" });
      clearPendingAction();
    }
    // Import/export/env actions are handled by their owners (SidebarHeader,
    // EnvSwitcher) — leave them in place for those listeners.
  }, [pendingAction, clearPendingAction]);

  // ─── Tree action handlers ────────────────────────────────────────────────
  const treeActions: SidebarTreeActions | null = rootPath
    ? {
        workspaceRoot: rootPath,
        onNewRequest: (parentPath) => setCreateTarget({ parentPath, kind: "request" }),
        onNewFolder: (parentPath) => setCreateTarget({ parentPath, kind: "folder" }),
        onRenameFile: (item: WorkspaceItem) =>
          setRenameTarget({ path: item.path, name: `${item.name}.bru`, kind: "file" }),
        onRenameFolder: (path, name) => setRenameTarget({ path, name, kind: "folder" }),
        onDeleteFile: (item: WorkspaceItem) =>
          setDeleteTarget({ path: item.path, name: item.name, kind: "file" }),
        onDeleteFolder: (path, name) => setDeleteTarget({ path, name, kind: "folder" }),
        onDuplicateFile: async (item) => {
          try {
            await duplicatePath(item.path);
            await refresh();
          } catch (e) {
            console.error("duplicate file failed", e);
          }
        },
        onDuplicateFolder: async (folderAbsPath) => {
          try {
            await duplicatePath(folderAbsPath);
            await refresh();
          } catch (e) {
            console.error("duplicate folder failed", e);
          }
        },
        onCopyAsCurl: async (item) => {
          try {
            const req = await readRequest(item.path);
            const editor = requestFromCollection(req);
            const wire = bodyToWire(editor.body) ?? { kind: "none" as const };
            const httpReq = {
              url: req.url,
              method: (isMethod(req.method) ? req.method : "GET") as Method,
              headers: kvRowsToTuples(editor.headers),
              query: kvRowsToTuples(editor.query),
              body: wire,
            };
            const curl = await exportCurl(httpReq);
            await navigator.clipboard.writeText(curl);
          } catch (e) {
            console.error("copy as curl failed", e);
          }
        },
        onRevealFile: async (item) => {
          // Reveal the request's parent folder — Windows Explorer doesn't
          // open files as folders, and the user just wants to see the file
          // alongside its siblings.
          const sep = item.path.includes("\\") ? "\\" : "/";
          const parent = item.path.slice(0, item.path.lastIndexOf(sep));
          await revealInFileManager(parent);
        },
        onRevealFolder: async (folderAbsPath) => {
          await revealInFileManager(folderAbsPath);
        },
      }
    : null;

  const handleRename = useCallback(
    async (newName: string) => {
      if (!renameTarget) return;
      const sep = renameTarget.path.includes("\\") ? "\\" : "/";
      const parent = renameTarget.path.slice(0, renameTarget.path.lastIndexOf(sep));
      // Preserve `.bru` extension for files even if user typed it without one.
      const finalName =
        renameTarget.kind === "file" && !newName.toLowerCase().endsWith(".bru")
          ? `${newName}.bru`
          : newName;
      const target = `${parent}${sep}${finalName}`;
      await renamePath(renameTarget.path, target);
      // Keep any open tab(s) pointing at the renamed file/folder valid — else
      // the next save writes to the now-deleted path. Prefix-aware so folder
      // renames fix descendant tabs too.
      retargetSavedPath(renameTarget.path, target);
      await refresh();
    },
    [renameTarget, refresh, retargetSavedPath],
  );

  const handleCreate = useCallback(
    async (newName: string) => {
      if (!createTarget) return;
      if (createTarget.kind === "folder") {
        await createFolder(createTarget.parentPath, newName);
        await refresh();
      } else {
        // "New request" no longer pre-writes an empty `.bru`. Instead we open
        // a fresh tab pre-aimed at the chosen folder — the user edits, then
        // Ctrl+S writes the file at the suggested location with the typed
        // name as the default. Avoids upfront naming friction (Postman-style).
        newTab({ name: newName, suggestedSaveDir: createTarget.parentPath });
      }
    },
    [createTarget, refresh, newTab],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    await deletePath(deleteTarget.path);
    await refresh();
  }, [deleteTarget, refresh]);

  if (!rootPath) {
    return <EmptyWorkspaceState openFolder={openFolder} />;
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveDrag(null);
        document.body.style.cursor = "";
      }}
    >
      <div className="absolute inset-0 flex min-w-0 flex-col">
        <SidebarHeader rootPath={rootPath} loading={loading} onRefresh={() => void refresh()} />

        <div className="flex items-center justify-between px-2 pt-2 pb-1">
          <h3 className="font-mono font-semibold text-[10px] text-muted-foreground/70 tracking-[0.15em] uppercase">
            Requests
            <span className="ml-1.5 nums-tabular text-muted-foreground/40">{items.length}</span>
          </h3>
          {/* One toggle, not two buttons: if everything is currently expanded,
              the next click collapses all; otherwise it expands all. The icon
              flips to telegraph what the click will do. */}
          <button
            type="button"
            onClick={() =>
              bulkMode === "open"
                ? useTree.getState().collapseAll()
                : useTree.getState().expandAll()
            }
            className="grid size-5 cursor-pointer place-items-center rounded-sm text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
            title={bulkMode === "open" ? "Collapse all folders" : "Expand all folders"}
            aria-label={bulkMode === "open" ? "Collapse all folders" : "Expand all folders"}
          >
            {bulkMode === "open" ? (
              <ChevronsDownUpIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <ChevronsUpDownIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            )}
          </button>
        </div>

        {/* Native overflow scroll — Radix ScrollArea's table-display wrapper
            fought the flex layout and wouldn't scroll. A plain
            `overflow-y-auto` is bulletproof; the OS scrollbar is themed via
            `color-scheme`. */}
        {/* The full-height scroll container itself is the context-menu trigger
            so a right-click ANYWHERE in the list opens the menu — including the
            empty space below items and the "no requests yet" state. Wrapping
            only RootDropZone failed: it is height:auto, so it covered just its
            own content and the lower (empty) scroller area fell through to the
            native WebView2 menu. */}
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <RootDropZone rootPath={rootPath}>
                {loading && items.length === 0 && (
                  <div className="space-y-1 px-2 py-1">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className="h-7 animate-pulse rounded-sm bg-muted/40"
                        style={{ animationDelay: `${i * 80}ms` }}
                      />
                    ))}
                  </div>
                )}
                {error && (
                  <div className="m-2 rounded-sm border border-destructive/30 bg-destructive/5 p-2 text-destructive text-xs">
                    {error}
                  </div>
                )}
                {!loading && !error && items.length === 0 && (
                  <div className="bg-mesh-primary flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                    <FilePlusIcon
                      className="size-7 text-muted-foreground/40"
                      strokeWidth={1.25}
                      aria-hidden="true"
                    />
                    <p className="font-medium text-foreground text-sm">No requests yet</p>
                    <p className="max-w-[28ch] text-muted-foreground/70 text-xs">
                      Right-click here to create one, or use the + buttons above.
                    </p>
                  </div>
                )}
                {/* Always show the tree if there are items — even while a refresh is
                  in flight — so the user keeps seeing their collection without
                  flicker. The refresh button still spins to indicate loading. */}
                {items.length > 0 && !error && treeActions && (
                  <SidebarTree
                    items={items}
                    activePath={activePath}
                    onSelect={async (it) => {
                      setActivePath(it.path);
                      try {
                        const req = await readRequest(it.path);
                        const method: Method = isMethod(req.method) ? req.method : "GET";
                        // Round-trip the on-disk collection back into editor
                        // shape. Previously the body field was hard-coded to
                        // { kind: "none" } here — saved bodies were silently
                        // dropped on reopen.
                        const editor = requestFromCollection(req);
                        openInTab(it.path, it.name, (t) => ({
                          ...t,
                          dirty: false,
                          request: {
                            url: req.url,
                            method,
                            // Preserve in-session state that isn't on disk —
                            // reopening an already-open file must not wipe the
                            // user's connection mode, request options, or captures.
                            mode: t.request.mode,
                            headers: editor.headers,
                            query: editor.query,
                            body: editor.body,
                            options: t.request.options,
                            vars: editor.vars,
                            captures: t.request.captures,
                            preRequestScript: editor.preRequestScript,
                            postResponseScript: editor.postResponseScript,
                          },
                          auth: editor.auth,
                        }));
                      } catch (e) {
                        console.error("read_request failed", e);
                      }
                    }}
                    actions={treeActions}
                  />
                )}
                {/* Spacer so right-click works in the bottom whitespace below items. */}
                <div className="flex-1" />
              </RootDropZone>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="min-w-[220px]">
            {CREATE_ACTIONS.map(renderCtxItem)}
            <ContextMenuSeparator />
            {IMPORT_ACTIONS.map(renderCtxItem)}
            <ContextMenuSeparator />
            {[ACT["export-workspace"], ACT.reveal, ACT.refresh].map(renderCtxItem)}
            <ContextMenuSeparator />
            {renderCtxItem(ACT.search)}
          </ContextMenuContent>
        </ContextMenu>

        {/* Action dialogs — single-instance, driven by the target state above */}
        {renameTarget && (
          <RenameDialog
            open={true}
            onOpenChange={(open) => !open && setRenameTarget(null)}
            kind={renameTarget.kind}
            currentName={renameTarget.name}
            onSubmit={handleRename}
          />
        )}
        {createTarget && (
          <CreateDialog
            open={true}
            onOpenChange={(open) => !open && setCreateTarget(null)}
            kind={createTarget.kind}
            parentLabel={createTarget.parentPath}
            // A folder whose parent is the workspace root is a top-level
            // *collection*; deeper ones are nested folders. Normalize
            // separators + trailing slashes so Windows roots compare cleanly.
            topLevel={
              normalizeForCompare(createTarget.parentPath) === normalizeForCompare(rootPath)
            }
            onSubmit={handleCreate}
          />
        )}
        {deleteTarget && (
          <DeleteDialog
            open={true}
            onOpenChange={(open) => !open && setDeleteTarget(null)}
            kind={deleteTarget.kind}
            name={deleteTarget.name}
            onConfirm={handleDelete}
          />
        )}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeDrag ? (
          <div className="pointer-events-none flex max-w-[260px] items-center gap-2 rounded-md border border-primary/40 bg-popover px-2.5 py-1.5 shadow-[var(--shadow-glow)] backdrop-blur-sm">
            <FileIcon
              className="size-3.5 shrink-0 text-primary"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <span
              className="min-w-12 shrink-0 rounded-[3px] border px-1.5 py-px text-center font-mono font-semibold text-[10px] uppercase tracking-wider"
              style={{
                color: methodColor(activeDrag.method),
                backgroundColor: `color-mix(in oklch, ${methodColor(activeDrag.method)} 14%, transparent)`,
                borderColor: `color-mix(in oklch, ${methodColor(activeDrag.method)} 25%, transparent)`,
              }}
            >
              {activeDrag.method || "DOC"}
            </span>
            <span className="min-w-0 truncate font-medium text-sm">{activeDrag.name}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * Empty-state shown when no workspace is open. Surfaces the recents list
 * front-and-center so a returning user can jump back into a project with
 * one click rather than navigating an OS file dialog.
 */
function EmptyWorkspaceState({ openFolder }: { openFolder: () => Promise<void> }) {
  const recent = useWorkspaces((s) => s.recent);
  const setRootPath = useWorkspace((s) => s.setRootPath);
  const refresh = useWorkspace((s) => s.refresh);
  const removeRecent = useWorkspaces((s) => s.remove);
  const requestAction = useUi((s) => s.requestAction);

  function pickRecent(path: string) {
    setRootPath(path);
    void refresh();
  }

  return (
    <div className="bg-mesh-primary absolute inset-0 flex min-w-0 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-col items-center gap-3 pt-6 text-center">
        <div className="grid size-14 place-items-center rounded-full bg-card shadow-sm ring-1 ring-border">
          <FolderPlusIcon
            className="size-7 text-muted-foreground/50"
            strokeWidth={1.25}
            aria-hidden="true"
          />
        </div>
        <div className="font-display text-xl italic text-muted-foreground">No workspace yet</div>
        <p className="max-w-[28ch] text-muted-foreground/80 text-xs leading-relaxed">
          Just type a name. Lancer saves your{" "}
          <code className="font-mono text-foreground">.bru</code> files under your Documents.
        </p>
        <div className="flex flex-col items-center gap-1.5">
          <Button
            size="sm"
            onClick={() => requestAction({ type: "new-workspace" })}
            className="shine-on-hover gap-1.5 shadow-sm transition-transform duration-150 hover:-translate-y-px active:scale-[0.98] active:translate-y-0"
          >
            <FolderPlusIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            New workspace
          </Button>
          <button
            type="button"
            onClick={() => void openFolder()}
            className="cursor-pointer text-[11px] text-muted-foreground/70 underline-offset-2 hover:text-foreground hover:underline"
          >
            or open an existing folder
            <span className="ml-1 font-mono text-[10px] text-muted-foreground/50">Ctrl+O</span>
          </button>
        </div>
      </div>

      {recent.length > 0 && (
        <div className="space-y-1">
          <h4 className="px-1 font-mono font-semibold text-[10px] text-muted-foreground/70 tracking-[0.15em] uppercase">
            Recent
          </h4>
          <ul className="space-y-1">
            {recent.slice(0, 8).map((w) => {
              const name = w.name?.trim() || leafName(w.path);
              return (
                <li key={w.path}>
                  <div className="group/r flex items-stretch gap-1 rounded-md border border-border/60 bg-card/40 transition-colors hover:border-primary/40 hover:bg-card">
                    <button
                      type="button"
                      onClick={() => pickRecent(w.path)}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 py-1.5 text-left"
                    >
                      <FolderOpenIcon
                        className="size-3.5 shrink-0 text-[color:var(--color-warning)]"
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-xs">{name}</div>
                        <div
                          className="truncate font-mono text-[10px] text-muted-foreground/60"
                          title={w.path}
                        >
                          {w.path}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRecent(w.path)}
                      className="mr-1 grid w-6 cursor-pointer place-items-center rounded-sm text-muted-foreground/40 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover/r:opacity-100"
                      aria-label={`Remove ${name} from recent`}
                      title="Forget this workspace"
                    >
                      <Trash2Icon className="size-3" strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Workspace-root drop zone — drag a request here to move it out of any
 * nested folder back to the top level. Lights up while a drag is hovering.
 */
function RootDropZone({
  rootPath,
  children,
  className,
  ref,
  ...rest
}: {
  rootPath: string;
  children: React.ReactNode;
  ref?: React.Ref<HTMLDivElement>;
} & React.HTMLAttributes<HTMLDivElement>) {
  const { setNodeRef, isOver } = useDroppable({
    id: "root",
    data: { type: "folder", path: rootPath },
  });
  // NOTE: no `min-h-full` here — that forced the content to exactly fill the
  // scroll viewport (with the trailing flex-1 spacer), so it never overflowed
  // and never scrolled. Plain `flex flex-col` lets tall trees overflow the
  // `overflow-y-auto` parent and scroll. The spacer still fills slack space
  // for right-click-on-empty when the tree is short.
  //
  // `...rest` + the merged ref are CRITICAL: ContextMenuTrigger uses Radix
  // Slot (`asChild`) to inject `onContextMenu` + its ref onto this element. A
  // bare `{ rootPath, children }` signature silently dropped them, so
  // right-click did nothing. We spread the trigger's props onto the div and
  // compose its ref with dnd-kit's `setNodeRef`.
  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.RefObject<HTMLDivElement | null>).current = node;
      }}
      className={`flex flex-col ${isOver ? "bg-primary/5 ring-1 ring-primary/30 ring-inset" : ""}${
        className ? ` ${className}` : ""
      }`}
      {...rest}
    >
      {children}
    </div>
  );
}
