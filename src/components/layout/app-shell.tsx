import { AuthPanel } from "@/components/request/auth-panel";
import { UrlBar } from "@/components/request/url-bar";
import { ResponseViewer } from "@/components/response/response-viewer";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sidebar } from "./sidebar";

export function AppShell() {
  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      <ResizablePanel defaultSize={20} minSize={15} maxSize={35}>
        <Sidebar />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={40} minSize={30}>
        <div className="flex h-full flex-col">
          <UrlBar />
          <AuthPanel />
          <div className="flex-1 p-3 text-muted-foreground text-sm">
            Body · Params · Headers — coming next.
          </div>
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={40} minSize={30}>
        <ResponseViewer />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
