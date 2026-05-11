import { MockPanel } from "@/components/mock/mock-panel";
import { AuthPanel } from "@/components/request/auth-panel";
import { EnvSwitcher } from "@/components/request/env-switcher";
import { UrlBar } from "@/components/request/url-bar";
import { ResponseViewer } from "@/components/response/response-viewer";
import { SettingsSheet } from "@/components/settings/settings-sheet";
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
          <div className="flex items-center justify-end gap-2 border-border border-b bg-card px-3 py-1">
            <SettingsSheet />
            <EnvSwitcher />
          </div>
          <UrlBar />
          <AuthPanel />
          <div className="flex-1 p-3 text-muted-foreground text-sm">
            Body · Params · Headers — coming next.
          </div>
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={40} minSize={30}>
        <div className="flex h-full flex-col">
          <ResponseViewer />
          <MockPanel />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
