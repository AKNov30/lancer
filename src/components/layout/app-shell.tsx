import { AuthPanel } from "@/components/request/auth-panel";
import { UrlBar } from "@/components/request/url-bar";
import { ResponseViewer } from "@/components/response/response-viewer";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sidebar } from "./sidebar";
import { StatusBar } from "./status-bar";
import { TopBar } from "./top-bar";

export function AppShell() {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <TopBar />

      <div className="min-h-0 min-w-0 flex-1">
        <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
          <ResizablePanel defaultSize={20} minSize={16} maxSize={35}>
            <Sidebar />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={45} minSize={30}>
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
          <ResizableHandle />
          <ResizablePanel defaultSize={35} minSize={25}>
            <ResponseViewer />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <StatusBar />
    </div>
  );
}
