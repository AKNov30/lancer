import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { JSONPath } from "jsonpath-plus";
import {
  CheckCircle2Icon,
  CheckIcon,
  CookieIcon,
  CopyIcon,
  DownloadIcon,
  FilterIcon,
  InboxIcon,
  Loader2,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { statusColor } from "@/lib/status-color";
import { saveBytes } from "@/lib/tauri";
import { tabMode, useRequest } from "@/stores/request-store";
import { toast } from "@/stores/toast-store";
import { useUi } from "@/stores/ui-store";
import { StreamPanel } from "./stream-panel";

function statusFamily(code: number): "5xx" | "4xx" | "3xx" | "2xx" | "other" {
  if (code >= 500) return "5xx";
  if (code >= 400) return "4xx";
  if (code >= 300) return "3xx";
  if (code >= 200) return "2xx";
  return "other";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Apply a JSONPath expression to the response body. Returns the matched
 * subset pretty-printed; `parsed: false` means the body isn't JSON, so the
 * UI should hide the filter input. Empty/whitespace paths short-circuit
 * to "no filter applied" (returns the full body pretty-printed).
 */
function applyJsonPath(
  bodyText: string | undefined,
  path: string,
): {
  result: string;
  error: string | null;
  parsed: boolean;
} {
  if (!bodyText) return { result: "(no body)", error: null, parsed: false };
  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return { result: bodyText, error: null, parsed: false };
  }
  if (!path.trim()) {
    return { result: JSON.stringify(json, null, 2), error: null, parsed: true };
  }
  try {
    // jsonpath-plus accepts JSON values typed loosely; cast for its narrower type.
    const matches = JSONPath({ path, json: json as object, wrap: true });
    return { result: JSON.stringify(matches, null, 2), error: null, parsed: true };
  } catch (e) {
    return {
      result: JSON.stringify(json, null, 2),
      error: e instanceof Error ? e.message : String(e),
      parsed: true,
    };
  }
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch (e) {
          console.error("copy body failed", e);
          toast.error("Couldn't copy to clipboard", {
            description: e instanceof Error ? e.message : String(e),
          });
        }
      }}
      className="flex h-7 cursor-pointer items-center gap-1 rounded-sm border border-border/60 bg-card px-2 text-muted-foreground text-xs transition-all duration-150 hover:border-primary/40 hover:text-foreground active:scale-95"
      aria-label={copied ? "Copied" : "Copy body"}
      title={copied ? "Copied!" : "Copy"}
    >
      {copied ? (
        <CheckIcon className="size-3 text-[color:var(--color-success)]" aria-hidden="true" />
      ) : (
        <CopyIcon className="size-3" aria-hidden="true" />
      )}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

/** Mapping of common Content-Type prefixes to file extensions. */
const EXT_BY_CONTENT_TYPE: { prefix: string; ext: string }[] = [
  { prefix: "application/json", ext: "json" },
  { prefix: "application/xml", ext: "xml" },
  { prefix: "text/xml", ext: "xml" },
  { prefix: "text/html", ext: "html" },
  { prefix: "text/css", ext: "css" },
  { prefix: "text/javascript", ext: "js" },
  { prefix: "application/javascript", ext: "js" },
  { prefix: "text/csv", ext: "csv" },
  { prefix: "text/plain", ext: "txt" },
  { prefix: "image/png", ext: "png" },
  { prefix: "image/jpeg", ext: "jpg" },
  { prefix: "image/gif", ext: "gif" },
  { prefix: "image/webp", ext: "webp" },
  { prefix: "image/svg+xml", ext: "svg" },
  { prefix: "application/pdf", ext: "pdf" },
  { prefix: "application/zip", ext: "zip" },
];

function suggestFilename(url: string, contentType: string | null): string {
  let stem = "response";
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    if (last) stem = last.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40) || "response";
  } catch {
    /* invalid URL — keep default stem */
  }
  let ext = "bin";
  if (contentType) {
    const found = EXT_BY_CONTENT_TYPE.find((e) => contentType.toLowerCase().startsWith(e.prefix));
    if (found) ext = found.ext;
  }
  // If stem already has an extension matching, don't double-add.
  if (stem.toLowerCase().endsWith(`.${ext}`)) return stem;
  return `${stem}.${ext}`;
}

function SaveButton({
  url,
  body,
  contentType,
}: {
  url: string;
  body: number[];
  contentType: string | null;
}) {
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  async function onSave() {
    setSaving(true);
    try {
      const defaultName = suggestFilename(url, contentType);
      const picked = await saveDialog({ defaultPath: defaultName });
      // A user-cancel resolves to `null` (not a throw), so it falls through
      // here silently — only a real write failure reaches the catch below.
      if (typeof picked === "string") {
        await saveBytes(picked, body);
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1500);
      }
    } catch (e) {
      console.error("save response failed", e);
      toast.error("Couldn't save response", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void onSave()}
      disabled={saving}
      className="flex h-7 cursor-pointer items-center gap-1 rounded-sm border border-border/60 bg-card px-2 text-muted-foreground text-xs transition-all duration-150 hover:border-primary/40 hover:text-foreground active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
      aria-label="Save response to file"
      title="Save response body to file"
    >
      {savedFlash ? (
        <CheckIcon className="size-3 text-[color:var(--color-success)]" aria-hidden="true" />
      ) : (
        <DownloadIcon className="size-3" aria-hidden="true" />
      )}
      <span>{savedFlash ? "Saved" : "Save"}</span>
    </button>
  );
}

/**
 * Picks the right result surface for the active tab: the classic HTTP
 * request/response viewer, or the live message stream panel for SSE/WebSocket.
 * HTTP mode is rendered exactly as before — pixel-identical.
 */
export function ResponseViewer() {
  const mode = useRequest((s) => tabMode(s.request));
  if (mode === "sse" || mode === "websocket") return <StreamPanel />;
  // gRPC shows its status + response JSON inline in the GrpcEditor surface, so
  // this side/bottom panel is just a neutral pointer rather than empty HTTP UI.
  if (mode === "grpc") return <GrpcResponseNote />;
  return <HttpResponseViewer />;
}

/** Placeholder shown in the response panel when the active tab is in gRPC mode. */
function GrpcResponseNote() {
  return (
    <div className="bg-mesh-primary absolute inset-0 flex min-w-0 flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-card shadow-sm ring-1 ring-border">
        <InboxIcon
          className="size-5 text-[color:var(--color-muted-foreground)]"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </div>
      <p className="max-w-xs text-muted-foreground text-sm">
        gRPC responses appear in the request panel below the body editor.
      </p>
    </div>
  );
}

function HttpResponseViewer() {
  const response = useRequest((s) => s.response);
  const error = useRequest((s) => s.error);
  const loading = useRequest((s) => s.loading);
  const requestUrl = useRequest((s) => s.request.url);
  const requestAction = useUi((s) => s.requestAction);

  /** JSONPath filter applied to the body view. */
  const [jsonPath, setJsonPath] = useState("");

  const filtered = useMemo(
    () => applyJsonPath(response?.bodyText, jsonPath),
    [response?.bodyText, jsonPath],
  );
  const formattedBody = filtered.result;

  const cookies = useMemo(() => {
    if (!response) return [];
    return response.headers.filter(([k]) => k.toLowerCase() === "set-cookie").map(([, v]) => v);
  }, [response]);

  const tests = response?.tests ?? [];
  const passedCount = tests.filter((t) => t.passed).length;
  const failedCount = tests.length - passedCount;
  const scriptLogs = response?.scriptLogs ?? [];

  if (loading) {
    return (
      <div className="bg-mesh-primary absolute inset-0 flex min-w-0 flex-col items-center justify-center gap-3 p-4">
        <div className="grid size-12 place-items-center rounded-full bg-card shadow-sm ring-1 ring-border">
          <Loader2
            className="size-5 animate-spin text-[color:var(--color-primary)]"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </div>
        <span className="font-mono text-muted-foreground text-sm">Sending request…</span>
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
      <div className="bg-mesh-primary absolute inset-0 flex min-w-0 flex-col items-center justify-center gap-3 p-4 text-center">
        <div className="grid size-14 place-items-center rounded-full bg-card shadow-sm ring-1 ring-border">
          <InboxIcon
            className="size-7 text-muted-foreground/50"
            strokeWidth={1.25}
            aria-hidden="true"
          />
        </div>
        <div className="font-display text-xl italic text-muted-foreground">No response yet</div>
        <p className="max-w-[28ch] text-muted-foreground/80 text-xs leading-relaxed">
          Send a request to see the result here.
        </p>
      </div>
    );
  }

  const family = statusFamily(response.status);
  const familyAccent: Record<typeof family, string> = {
    "2xx": "var(--color-success)",
    "3xx": "var(--color-info)",
    "4xx": "var(--color-warning)",
    "5xx": "var(--color-destructive)",
    other: "var(--color-muted-foreground)",
  };

  return (
    <div className="absolute inset-0 flex min-w-0 flex-col">
      {/* Status strip with left accent bar (extra pl-4 to clear the accent) */}
      <div
        className="relative flex shrink-0 items-center gap-3 border-border border-b bg-card pl-4 pr-3 py-2 font-mono text-xs nums-tabular"
        style={{ boxShadow: `inset 3px 0 0 0 ${familyAccent[family]}` }}
      >
        <span
          className="relative inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 font-semibold"
          style={{
            color: statusColor(response.status),
            backgroundColor: `color-mix(in oklch, ${statusColor(response.status)} 12%, transparent)`,
            borderColor: `color-mix(in oklch, ${statusColor(response.status)} 30%, transparent)`,
          }}
        >
          <span
            aria-hidden="true"
            key={response.status}
            className="size-1.5 rounded-full animate-in zoom-in-50 duration-300"
            style={{ backgroundColor: statusColor(response.status) }}
          />
          {response.status} {response.statusText}
        </span>
        <span aria-hidden="true" className="text-muted-foreground/40">
          ·
        </span>
        <span
          className="text-muted-foreground"
          title={
            response.ttfbMs !== undefined && response.downloadMs !== undefined
              ? `Total round-trip · TTFB ${response.ttfbMs} ms (DNS + connect + TLS + server response) · Download ${response.downloadMs} ms (body bytes)`
              : "Round-trip time"
          }
        >
          {response.elapsedMs} ms
          {response.ttfbMs !== undefined && response.downloadMs !== undefined && (
            <span className="ml-1 text-muted-foreground/60 text-[10px] nums-tabular">
              ({response.ttfbMs}+{response.downloadMs})
            </span>
          )}
        </span>
        <span aria-hidden="true" className="text-muted-foreground/40">
          ·
        </span>
        <span className="text-muted-foreground" title="Response body size">
          {formatBytes(response.sizeBytes)}
        </span>
      </div>
      <Tabs defaultValue="body" className="flex min-h-0 flex-1 flex-col">
        <TabsList variant="line" className="h-9 rounded-none border-border border-b bg-card px-2">
          <TabsTrigger value="body">Body</TabsTrigger>
          <TabsTrigger value="headers">
            Headers
            <span className="ml-1 nums-tabular text-muted-foreground/70 text-[10px]">
              {response.headers.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="cookies">
            Cookies
            {cookies.length > 0 && (
              <Badge variant="secondary" className="ml-1 px-1 py-px text-[10px] leading-none">
                {cookies.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="tests">
            Tests
            {tests.length > 0 && (
              <span
                className="ml-1 rounded-sm px-1 nums-tabular text-[10px]"
                style={{
                  color: failedCount > 0 ? "var(--color-destructive)" : "var(--color-success)",
                  backgroundColor: `color-mix(in oklch, ${
                    failedCount > 0 ? "var(--color-destructive)" : "var(--color-success)"
                  } 14%, transparent)`,
                }}
                title={`${passedCount} passed · ${failedCount} failed`}
              >
                {passedCount}/{tests.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="body" className="flex min-h-0 flex-1 flex-col">
          {/* Sticky toolbar above body — filter + copy + save buttons stay out of the viewport */}
          <div className="flex shrink-0 items-center gap-2 border-border/60 border-b bg-card/50 px-3 py-1.5">
            {filtered.parsed && (
              <div className="group/filter relative flex-1 min-w-0">
                <FilterIcon
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground/50"
                  strokeWidth={1.75}
                />
                <Input
                  value={jsonPath}
                  onChange={(e) => setJsonPath(e.target.value)}
                  placeholder="JSONPath filter, e.g. $.data[*].id"
                  className="h-7 cursor-text border-border/60 bg-background pl-7 pr-7 font-mono text-xs shadow-none focus:shadow-[var(--shadow-glow)]"
                  aria-label="JSONPath filter"
                  title="Apply a JSONPath expression to the body"
                />
                {jsonPath && (
                  <button
                    type="button"
                    onClick={() => setJsonPath("")}
                    className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 cursor-pointer place-items-center rounded-sm text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                    aria-label="Clear filter"
                    title="Clear filter"
                  >
                    <XIcon className="size-3" strokeWidth={1.75} aria-hidden="true" />
                  </button>
                )}
                {filtered.error && (
                  <p
                    className="absolute top-full right-0 mt-0.5 truncate font-mono text-[10px] text-destructive"
                    title={filtered.error}
                  >
                    {filtered.error}
                  </p>
                )}
              </div>
            )}
            <SaveButton
              url={requestUrl}
              body={response.body}
              contentType={
                response.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? null
              }
            />
            <CopyButton value={formattedBody} />
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <pre className="whitespace-pre-wrap p-3 font-mono text-xs">{formattedBody}</pre>
          </div>
        </TabsContent>

        <TabsContent value="headers" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <Table className="font-mono text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead className="h-8 min-w-[160px] text-muted-foreground text-[10px] tracking-wider uppercase">
                    Name
                  </TableHead>
                  <TableHead className="h-8 text-muted-foreground text-[10px] tracking-wider uppercase">
                    Value
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {response.headers.map(([k, v]) => (
                  <TableRow key={`${k}:${v}`}>
                    <TableCell className="align-top px-3 py-1 text-muted-foreground">{k}</TableCell>
                    <TableCell className="break-all whitespace-normal px-3 py-1">{v}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="cookies" className="min-h-0 flex-1">
          <div className="flex items-center justify-between gap-2 border-border/60 border-b px-3 py-1.5">
            <span className="text-muted-foreground/70 text-[11px]">
              Read-only Set-Cookie headers from this response.
            </span>
            <Button
              variant="outline"
              size="xs"
              className="cursor-pointer gap-1"
              onClick={() => requestAction({ type: "open-cookies" })}
            >
              <CookieIcon className="size-3" strokeWidth={1.75} aria-hidden="true" />
              Manage cookie jar
            </Button>
          </div>
          <ScrollArea className="h-[calc(100%-2.25rem)]">
            {cookies.length === 0 ? (
              <p className="p-3 text-muted-foreground text-xs">
                No Set-Cookie headers in this response.
              </p>
            ) : (
              <Table className="font-mono text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-8 w-10 text-muted-foreground text-[10px] tracking-wider uppercase">
                      #
                    </TableHead>
                    <TableHead className="h-8 text-muted-foreground text-[10px] tracking-wider uppercase">
                      Set-Cookie value
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cookies.map((v, idx) => (
                    <TableRow key={v}>
                      <TableCell className="align-top px-3 py-1 text-muted-foreground nums-tabular">
                        {idx + 1}
                      </TableCell>
                      <TableCell className="break-all whitespace-normal px-3 py-1">{v}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="tests" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            {response.scriptError && (
              <div className="border-destructive/30 border-b bg-destructive/5 px-3 py-2">
                <p className="font-medium text-destructive text-xs">Script error</p>
                <pre className="mt-0.5 whitespace-pre-wrap break-all font-mono text-[11px] text-destructive/90">
                  {response.scriptError}
                </pre>
              </div>
            )}
            {scriptLogs.length > 0 && (
              <div className="border-border/60 border-b bg-card/40 px-3 py-2">
                <p className="mb-1 font-mono font-semibold text-[10px] text-muted-foreground/70 tracking-[0.15em] uppercase">
                  Console
                </p>
                <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground leading-relaxed">
                  {scriptLogs.join("\n")}
                </pre>
              </div>
            )}
            {tests.length === 0 && scriptLogs.length === 0 && (
              <p className="p-3 text-muted-foreground text-xs leading-relaxed">
                No tests ran. Add assertions in the request{" "}
                <span className="font-medium">Scripts → Post-response</span> tab using{" "}
                <code className="rounded-sm border border-border bg-card px-1 font-mono text-[11px]">
                  lancer.test(name, () =&gt; expect(...).toBe(...))
                </code>
                .
              </p>
            )}
            {tests.length > 0 && (
              <div className="flex flex-col">
                {/* Summary header */}
                <div className="sticky top-0 flex items-center gap-2 border-border/60 border-b bg-card/80 px-3 py-1.5 backdrop-blur">
                  <span
                    className="inline-flex items-center gap-1 font-medium text-xs"
                    style={{ color: "var(--color-success)" }}
                  >
                    <CheckCircle2Icon className="size-3.5" strokeWidth={2} aria-hidden="true" />
                    {passedCount} passed
                  </span>
                  {failedCount > 0 && (
                    <>
                      <span aria-hidden="true" className="text-muted-foreground/40">
                        ·
                      </span>
                      <span
                        className="inline-flex items-center gap-1 font-medium text-xs"
                        style={{ color: "var(--color-destructive)" }}
                      >
                        <XCircleIcon className="size-3.5" strokeWidth={2} aria-hidden="true" />
                        {failedCount} failed
                      </span>
                    </>
                  )}
                </div>
                <ul className="divide-y divide-border/40">
                  {tests.map((t, idx) => (
                    <li
                      // biome-ignore lint/suspicious/noArrayIndexKey: test results are a fixed list regenerated wholesale per send
                      key={`${idx}:${t.name}`}
                      className="flex items-start gap-2 px-3 py-2 font-mono text-xs"
                    >
                      {t.passed ? (
                        <CheckCircle2Icon
                          className="mt-0.5 size-3.5 shrink-0 text-[color:var(--color-success)]"
                          strokeWidth={2}
                          aria-hidden="true"
                        />
                      ) : (
                        <XCircleIcon
                          className="mt-0.5 size-3.5 shrink-0 text-[color:var(--color-destructive)]"
                          strokeWidth={2}
                          aria-hidden="true"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <span
                          className={t.passed ? "text-foreground" : "font-medium text-destructive"}
                        >
                          {t.name}
                        </span>
                        {!t.passed && t.error && (
                          <pre className="mt-0.5 whitespace-pre-wrap break-all text-[11px] text-muted-foreground">
                            {t.error}
                          </pre>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
