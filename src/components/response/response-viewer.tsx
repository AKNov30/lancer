import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRequest } from "@/stores/request-store";

function statusColor(code: number): string {
  if (code >= 500) return "var(--color-destructive)";
  if (code >= 400) return "var(--color-warning)";
  if (code >= 300) return "var(--color-info)";
  if (code >= 200) return "var(--color-success)";
  return "var(--color-muted-foreground)";
}

function prettyBody(text?: string): string {
  if (!text) return "(no body)";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function ResponseViewer() {
  const response = useRequest((s) => s.response);
  const error = useRequest((s) => s.error);
  const loading = useRequest((s) => s.loading);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="font-mono text-muted-foreground text-sm">Sending…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="m-4 rounded-md border border-destructive/40 bg-destructive/10 p-3">
        <div className="mb-1 font-semibold text-destructive text-xs">Request failed</div>
        <pre className="whitespace-pre-wrap font-mono text-xs">{error}</pre>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-muted-foreground text-sm">No response yet.</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-border border-b bg-card px-3 py-2 font-mono text-xs">
        <span style={{ color: statusColor(response.status) }} className="font-semibold">
          {response.status} {response.statusText}
        </span>
        <span className="text-muted-foreground">·</span>
        <span>{response.elapsedMs} ms</span>
        <span className="text-muted-foreground">·</span>
        <span>{response.sizeBytes} B</span>
      </div>
      <Tabs defaultValue="body" className="flex flex-1 flex-col">
        <TabsList className="h-9 rounded-none border-border border-b bg-card px-2">
          <TabsTrigger value="body">Body</TabsTrigger>
          <TabsTrigger value="headers">Headers</TabsTrigger>
        </TabsList>
        <TabsContent value="body" className="flex-1">
          <ScrollArea className="h-full">
            <pre className="whitespace-pre-wrap p-3 font-mono text-xs">
              {prettyBody(response.bodyText)}
            </pre>
          </ScrollArea>
        </TabsContent>
        <TabsContent value="headers" className="flex-1">
          <ScrollArea className="h-full">
            <table className="w-full font-mono text-xs">
              <tbody>
                {response.headers.map(([k, v]) => (
                  <tr key={`${k}:${v}`} className="border-border border-b">
                    <td className="px-3 py-1 align-top text-muted-foreground">{k}</td>
                    <td className="break-all px-3 py-1">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
