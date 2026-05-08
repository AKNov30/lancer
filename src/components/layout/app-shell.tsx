import { UrlBar } from "@/components/request/url-bar";
import { ResponseViewer } from "@/components/response/response-viewer";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

export function AppShell() {
  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      <ResizablePanel defaultSize={50} minSize={30}>
        <div className="flex h-full flex-col">
          <UrlBar />
          <div className="flex-1 p-3 text-muted-foreground text-sm">
            Body · Params · Headers · Auth — coming in M5+.
          </div>
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={50} minSize={30}>
        <ResponseViewer />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
