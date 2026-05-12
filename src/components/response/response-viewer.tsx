import { useMemo } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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

  const formattedBody = useMemo(() => prettyBody(response?.bodyText), [response?.bodyText]);

  const cookies = useMemo(() => {
    if (!response) return [];
    return response.headers.filter(([k]) => k.toLowerCase() === "set-cookie").map(([, v]) => v);
  }, [response]);

  if (loading) {
    return (
      <div className="flex h-full min-w-0 flex-col items-center justify-center gap-3 p-4">
        <div className="flex items-center gap-2">
          <span className="size-2 animate-pulse rounded-full bg-[color:var(--color-primary)]" />
          <span className="font-mono text-muted-foreground text-sm">Sending…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-w-0 p-3">
        <Alert variant="destructive">
          <AlertTitle>Request failed</AlertTitle>
          <AlertDescription>
            <pre className="whitespace-pre-wrap break-all font-mono text-xs">{error}</pre>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="flex h-full min-w-0 flex-col items-center justify-center gap-2 p-4 text-center">
        <div className="font-display text-xl italic text-muted-foreground">No response yet</div>
        <p className="max-w-[28ch] text-muted-foreground/80 text-xs leading-relaxed">
          Send a request to see the result here.
        </p>
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
          <TabsTrigger value="cookies">
            Cookies
            {cookies.length > 0 && (
              <Badge variant="secondary" className="ml-1 px-1 py-px text-[10px] leading-none">
                {cookies.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="body" className="flex-1">
          <ScrollArea className="h-full">
            <pre className="whitespace-pre-wrap p-3 font-mono text-xs">{formattedBody}</pre>
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
        <TabsContent value="cookies" className="flex-1">
          <ScrollArea className="h-full">
            {cookies.length === 0 ? (
              <p className="p-3 text-muted-foreground text-xs">
                No Set-Cookie headers in this response.
              </p>
            ) : (
              <table className="w-full font-mono text-xs">
                <thead>
                  <tr className="border-border border-b text-muted-foreground">
                    <th className="px-3 py-1 text-left font-medium">#</th>
                    <th className="px-3 py-1 text-left font-medium">Set-Cookie value</th>
                  </tr>
                </thead>
                <tbody>
                  {cookies.map((v, idx) => (
                    <tr key={v} className="border-border border-b">
                      <td className="px-3 py-1 align-top text-muted-foreground">{idx + 1}</td>
                      <td className="break-all px-3 py-1">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
