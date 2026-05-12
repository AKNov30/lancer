import { AuthPanel } from "@/components/request/auth-panel";
import { UrlBar } from "@/components/request/url-bar";
import { ResponseViewer } from "@/components/response/response-viewer";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sidebar } from "./sidebar";
import { StatusBar } from "./status-bar";
import { TopBar } from "./top-bar";

/**
 * Inline overflow style is critical: without it, content inside a ResizablePanel
 * can force the panel wider than its allotted size — which is the bug that made
 * the sidebar look squeezed (the editor's wide content was eating the sidebar's
 * percentage allocation).
 */
const PANEL_STYLE: React.CSSProperties = { overflow: "hidden" };

export function AppShell() {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <TopBar />

      <div className="min-h-0 min-w-0 flex-1">
        <ResizablePanelGroup
          orientation="horizontal"
          autoSave="lancer.layout.main"
          className="h-full w-full"
        >
          <ResizablePanel
            id="sidebar"
            defaultSize={22}
            minSize={16}
            maxSize={40}
            style={PANEL_STYLE}
          >
            <Sidebar />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel id="editor" defaultSize={45} minSize={30} style={PANEL_STYLE}>
            <div className="flex h-full min-w-0 flex-col">
              <UrlBar />
              <AuthPanel />
              <div className="flex flex-1 items-center justify-center p-6 text-center">
                <div className="max-w-sm">
                  <p className="font-mono text-muted-foreground text-xs">Body · Params · Headers</p>
                  <p className="mt-1 text-muted-foreground/60 text-xs">
                    Coming in the next milestone — edit your <code className="font-mono">.bru</code>{" "}
                    files directly for now.
                  </p>
                </div>
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel id="response" defaultSize={33} minSize={20} style={PANEL_STYLE}>
            <ResponseViewer />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <StatusBar />
    </div>
  );
}
