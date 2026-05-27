import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { CollectionRunner } from "@/components/collection-runner";
import { CollectionSettingsSheet } from "@/components/collection-settings-sheet";
import { CommandPalette } from "@/components/command-palette";
import { CookieManagerSheet } from "@/components/cookies/cookie-manager-sheet";
import { ExportPostmanHandler } from "@/components/export-postman-handler";
import { ImportFromFileHandler } from "@/components/importers/import-from-file-handler";
import { NewWorkspaceDialog } from "@/components/new-workspace-dialog";
import { GrpcEditor } from "@/components/request/grpc-editor";
import { RequestBreadcrumb } from "@/components/request/request-breadcrumb";
import { RequestEditor } from "@/components/request/request-editor";
import { UrlBar } from "@/components/request/url-bar";
import { ResponseViewer } from "@/components/response/response-viewer";
import { ShortcutsDialog } from "@/components/shortcuts-dialog";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { WorkspaceExportDialog } from "@/components/workspace-export-dialog";
import { requestFromCollection } from "@/lib/collection-convert";
import { readRequest, startWatching } from "@/lib/tauri";
import { isMethod, type Method } from "@/lib/types";
import { useLayout } from "@/stores/layout-store";
import { tabMode, useRequest, useTabs } from "@/stores/request-store";
import { useWorkspace } from "@/stores/workspace-store";
import { Sidebar } from "./sidebar";
import { StatusBar } from "./status-bar";
import { TabBar } from "./tab-bar";
import { TopBar } from "./top-bar";

/**
 * react-resizable-panels v4 quirks:
 *  - **numeric** size values are interpreted as PIXELS (e.g. `defaultSize={22}`
 *    = 22px); STRING values without a unit are PERCENT of the parent group.
 *  - The Panel's content div ships `overflow:auto; max-height:100%` by
 *    default. We make it a **flex column** so its child can be a `flex-1
 *    min-h-0` scroll region — `h-full` on the child would collapse because
 *    the panel's own `height` is `auto` (only `max-height:100%`). This is the
 *    documented pattern for scrollable panel content.
 */
const PANEL_STYLE: React.CSSProperties = {
  overflow: "hidden",
  // Positioning context for the absolutely-filled content below. The panel
  // gets a real pixel size from react-resizable-panels, so `absolute inset-0`
  // children inherit a DEFINITE height — sidestepping the flex `height:100%`
  // vs `height:auto` trap that left scroll regions unbounded (content == box
  // height → never overflowed → wheel did nothing, while Tab/scrollIntoView
  // still moved the overflow:hidden panel, which looked like "kinda scrolls").
  position: "relative",
};

/** Fills the parent panel exactly via absolute positioning → definite height. */
const PANEL_FILL = "absolute inset-0 flex min-w-0 flex-col";

function EditorColumn() {
  // gRPC mode swaps the tabbed HTTP editor for the proto/method/JSON surface.
  // Its response is shown inline in that surface, so the side ResponseViewer
  // renders a neutral gRPC note instead of the HTTP empty state.
  const isGrpc = useRequest((s) => tabMode(s.request) === "grpc");
  return (
    <div className={PANEL_FILL}>
      <TabBar />
      <RequestBreadcrumb />
      <UrlBar />
      <div className="min-h-0 flex-1">{isGrpc ? <GrpcEditor /> : <RequestEditor />}</div>
    </div>
  );
}

export function AppShell() {
  const responseOrientation = useLayout((s) => s.responseOrientation);
  const rootPath = useWorkspace((s) => s.rootPath);
  const refresh = useWorkspace((s) => s.refresh);

  // ── File-system watcher bridge ───────────────────────────────────────────
  // On mount: if a workspace is already loaded from localStorage, ensure the
  // Rust file watcher is running (setRootPath only fires on change, so an
  // initial-mount restore otherwise misses it). Also subscribe to the
  // `workspace://changed` event so external edits auto-refresh the sidebar.
  useEffect(() => {
    if (rootPath) {
      void startWatching(rootPath).catch(() => {});
    }
  }, [rootPath]);

  // Ctrl/Cmd+O → open folder. Browser-style "open file" but for workspaces.
  // Ignored when typing in an input so Ctrl+O inside a header field doesn't
  // surprise the user with a file picker.
  const openFolder = useWorkspace((s) => s.openFolder);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "o") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      e.preventDefault();
      void openFolder();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openFolder]);

  useEffect(() => {
    const unlistenPromise = listen("workspace://changed", () => {
      void refresh();
      // Re-hydrate any open tab that's CLEAN and points at an actual file
      // on disk. Dirty tabs (unsaved edits) are skipped so we don't clobber
      // the user's in-flight work — they'll see the stale view until they
      // save or discard, which matches editor norms (VS Code does the same).
      const { tabs } = useTabs.getState();
      for (const tab of tabs) {
        if (!tab.savedPath || tab.dirty) continue;
        void (async () => {
          try {
            const req = await readRequest(tab.savedPath as string);
            const method: Method = isMethod(req.method) ? req.method : "GET";
            const editor = requestFromCollection(req);
            useTabs.setState((s) => ({
              tabs: s.tabs.map((t) =>
                t.id === tab.id
                  ? {
                      ...t,
                      request: {
                        url: req.url,
                        method,
                        // Connection mode lives only in-session (not on disk),
                        // so preserve it across an external-file re-hydrate.
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
                    }
                  : t,
              ),
            }));
          } catch {
            // File may have been deleted/renamed externally — the tab keeps
            // its in-memory state and the user can save-as to a new path.
          }
        })();
      }
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [refresh]);

  // We swap the autoSave key per orientation so each layout remembers its
  // own panel sizes independently — switching back-and-forth doesn't squash
  // the previous arrangement.
  const autoSaveKey =
    responseOrientation === "bottom" ? "lancer.layout.v3.bottom" : "lancer.layout.v3.right";

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <TopBar />

      <div className="min-h-0 min-w-0 flex-1">
        <ResizablePanelGroup
          orientation="horizontal"
          autoSave={autoSaveKey}
          className="h-full w-full"
        >
          <ResizablePanel
            id="sidebar"
            defaultSize="22"
            minSize="14"
            maxSize="50"
            style={PANEL_STYLE}
          >
            <Sidebar />
          </ResizablePanel>

          <ResizableHandle withHandle />

          {responseOrientation === "right" ? (
            <>
              <ResizablePanel id="editor" defaultSize="45" minSize="25" style={PANEL_STYLE}>
                <EditorColumn />
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel id="response" defaultSize="33" minSize="18" style={PANEL_STYLE}>
                <ResponseViewer />
              </ResizablePanel>
            </>
          ) : (
            <ResizablePanel id="main" defaultSize="78" minSize="40" style={PANEL_STYLE}>
              <ResizablePanelGroup
                orientation="vertical"
                autoSave="lancer.layout.v3.bottom.inner"
                className="h-full w-full"
              >
                <ResizablePanel id="editor" defaultSize="55" minSize="20" style={PANEL_STYLE}>
                  <EditorColumn />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel id="response" defaultSize="45" minSize="15" style={PANEL_STYLE}>
                  <ResponseViewer />
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
          )}
        </ResizablePanelGroup>
      </div>

      <StatusBar />
      <CommandPalette />
      <ExportPostmanHandler />
      <CollectionRunner />
      <ShortcutsDialog />
      <CollectionSettingsSheet />
      <CookieManagerSheet />
      <ImportFromFileHandler />
      <WorkspaceExportDialog />
      <NewWorkspaceDialog />
    </div>
  );
}
