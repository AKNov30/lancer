import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  BinaryIcon,
  BracesIcon,
  FolderOpenIcon,
  GitBranchIcon,
  ListIcon,
  PaperclipIcon,
  PencilLineIcon,
  WrapText,
} from "lucide-react";
import { useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/code-editor";
import { Input } from "@/components/ui/input";
import { KvTable } from "@/components/ui/kv-table";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Body, KvRow, MultipartField } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useRequest } from "@/stores/request-store";

const KIND_LABELS: Record<Body["kind"], { label: string; icon: typeof BracesIcon }> = {
  none: { label: "None", icon: WrapText },
  json: { label: "JSON", icon: BracesIcon },
  raw: { label: "Raw", icon: PencilLineIcon },
  form: { label: "Form", icon: ListIcon },
  multipart: { label: "Multipart", icon: PaperclipIcon },
  binary: { label: "Binary", icon: BinaryIcon },
  graphql: { label: "GraphQL", icon: GitBranchIcon },
};

const RAW_CONTENT_TYPES = [
  "text/plain",
  "text/html",
  "text/xml",
  "application/xml",
  "application/javascript",
];

const BINARY_CONTENT_TYPES = [
  "application/octet-stream",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/zip",
];

/**
 * Convert between body kinds while preserving as much data as possible.
 * Switching kinds replaces the body shape entirely — fields specific to the
 * previous kind are discarded. (Matches Postman/Bruno UX.)
 */
function emptyBodyOfKind(kind: Body["kind"]): Body {
  switch (kind) {
    case "none":
      return { kind: "none" };
    case "json":
      return { kind: "json", text: "" };
    case "raw":
      return { kind: "raw", text: "", contentType: "text/plain" };
    case "form":
      return { kind: "form", fields: [] };
    case "multipart":
      return { kind: "multipart", fields: [] };
    case "binary":
      return { kind: "binary", path: "", contentType: "application/octet-stream" };
    case "graphql":
      return { kind: "graphql", query: "", variables: "" };
  }
}

export function BodyEditor() {
  const body = useRequest((s) => s.request.body);
  const setBody = useRequest((s) => s.setBody);

  const kind = body.kind;

  /**
   * Per-tab per-kind cache so switching JSON → Form → JSON brings back the
   * JSON text you typed, instead of wiping it. Lives in a ref keyed by the
   * editor tab session — cleared when the BodyEditor unmounts.
   */
  const kindCacheRef = useRef<Partial<Record<Body["kind"], Body>>>({});
  // Mirror the current body into the cache so even an external change (e.g.
  // cURL paste) ends up restorable.
  kindCacheRef.current[kind] = body;

  return (
    <Tabs
      value={kind}
      onValueChange={(v) => {
        if (v === kind) return;
        const targetKind = v as Body["kind"];
        const cached = kindCacheRef.current[targetKind];
        setBody(cached ?? emptyBodyOfKind(targetKind));
      }}
      className="flex h-full min-h-0 flex-col"
    >
      <div className="shrink-0 border-border/40 border-b">
        <div className="overflow-x-auto">
          <TabsList variant="line" className="h-8 w-max min-w-full justify-start gap-0 px-3">
            {(Object.entries(KIND_LABELS) as [Body["kind"], (typeof KIND_LABELS)["none"]][]).map(
              ([k, { label, icon: Icon }]) => (
                <TabsTrigger key={k} value={k} className="cursor-pointer gap-1.5 text-xs">
                  <Icon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                  {label}
                </TabsTrigger>
              ),
            )}
          </TabsList>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <TabsContent
          value="none"
          className="bg-mesh-primary m-0 flex h-full flex-col items-center justify-center gap-2 p-6 text-center"
        >
          <div className="grid size-10 place-items-center rounded-full bg-card shadow-sm ring-1 ring-border">
            <WrapText
              className="size-5 text-muted-foreground/50"
              strokeWidth={1.5}
              aria-hidden="true"
            />
          </div>
          <p className="font-medium text-foreground text-sm">No request body</p>
          <p className="max-w-[32ch] text-muted-foreground/70 text-xs">
            Pick a content type above (JSON, Form, Binary, etc.) to start composing one.
          </p>
        </TabsContent>

        {body.kind === "json" && (
          <TabsContent value="json" className="m-0 flex h-full flex-col p-3">
            <JsonBody value={body.text} onChange={(text) => setBody({ kind: "json", text })} />
          </TabsContent>
        )}

        {body.kind === "raw" && (
          <TabsContent value="raw" className="m-0 flex h-full flex-col p-3">
            <RawBody
              text={body.text}
              contentType={body.contentType}
              onChange={(patch) => setBody({ ...body, ...patch })}
            />
          </TabsContent>
        )}

        {body.kind === "form" && (
          <TabsContent value="form" className="m-0 flex h-full flex-col p-3">
            <KvTable
              rows={body.fields}
              onChange={(fields) => setBody({ kind: "form", fields })}
              keyPlaceholder="field"
              valuePlaceholder="value"
              hint="Sent as application/x-www-form-urlencoded. Use Multipart instead if you need file uploads."
            />
          </TabsContent>
        )}

        {body.kind === "multipart" && (
          <TabsContent value="multipart" className="m-0 flex h-full flex-col p-3">
            <MultipartBody
              fields={body.fields}
              onChange={(fields) => setBody({ kind: "multipart", fields })}
            />
          </TabsContent>
        )}

        {body.kind === "binary" && (
          <TabsContent value="binary" className="m-0 flex h-full flex-col p-3">
            <BinaryBody
              path={body.path}
              contentType={body.contentType}
              onChange={(patch) => setBody({ ...body, ...patch })}
            />
          </TabsContent>
        )}

        {body.kind === "graphql" && (
          <TabsContent value="graphql" className="m-0 flex h-full flex-col p-3">
            <GraphQLBody
              query={body.query}
              variables={body.variables}
              onChange={(patch) => setBody({ ...body, ...patch })}
            />
          </TabsContent>
        )}
      </div>
    </Tabs>
  );
}

// ─── Body-kind sub-editors ────────────────────────────────────────────────────

function JsonBody({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  function format() {
    try {
      const parsed = JSON.parse(value);
      onChange(JSON.stringify(parsed, null, 2));
    } catch {
      /* leave as-is on parse error — user might be mid-typing */
    }
  }

  const isValid = useMemo(() => {
    if (!value.trim()) return true;
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  }, [value]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted-foreground/70 tracking-wider uppercase">
            application/json
          </span>
          {!isValid && value.trim() && (
            <span
              className="rounded-sm border border-destructive/30 bg-destructive/5 px-1.5 py-0.5 font-mono text-[10px] text-destructive"
              title="Invalid JSON — request will still send as-is"
            >
              invalid JSON
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={format}
          disabled={!isValid || !value.trim()}
          className="h-7 cursor-pointer gap-1.5 px-2 text-xs disabled:cursor-not-allowed"
          title="Format and indent"
        >
          <BracesIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
          Beautify
        </Button>
      </div>
      <CodeEditor
        value={value}
        onChange={onChange}
        language="json"
        placeholder='{ "key": "value" }'
        minHeight="240px"
        className={cn("flex-1 min-h-0", !isValid && value.trim() && "border-destructive/50")}
      />
    </div>
  );
}

function RawBody({
  text,
  contentType,
  onChange,
}: {
  text: string;
  contentType: string;
  onChange: (p: { text?: string; contentType?: string }) => void;
}) {
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <Label
          htmlFor="raw-ct"
          className="font-mono text-[10px] text-muted-foreground/70 tracking-wider uppercase"
        >
          Content-Type
        </Label>
        <Select value={contentType} onValueChange={(v) => onChange({ contentType: v })}>
          <SelectTrigger id="raw-ct" className="h-7 w-[220px] cursor-pointer text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RAW_CONTENT_TYPES.map((ct) => (
              <SelectItem key={ct} value={ct} className="cursor-pointer font-mono text-xs">
                {ct}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <CodeEditor
        value={text}
        onChange={(v) => onChange({ text: v })}
        // Pick a sensible CodeMirror language based on the chosen
        // content-type so XML and HTML get their own syntax colors.
        language={
          contentType.includes("xml")
            ? "xml"
            : contentType.includes("html")
              ? "html"
              : contentType.includes("javascript")
                ? "javascript"
                : "text"
        }
        placeholder="Raw body content…"
        minHeight="240px"
        className="flex-1 min-h-0"
      />
    </div>
  );
}

function MultipartBody({
  fields,
  onChange,
}: {
  fields: MultipartField[];
  onChange: (f: MultipartField[]) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 rounded-md border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/5 px-3 py-2 text-xs">
        <span className="text-foreground">
          <strong>Multipart wire support coming soon.</strong> Edit + save to{" "}
          <code className="font-mono">.bru</code> works today; sending over the network ships in the
          next release.
        </span>
      </div>
      <MultipartTable fields={fields} onChange={onChange} />
    </div>
  );
}

function MultipartTable({
  fields,
  onChange,
}: {
  fields: MultipartField[];
  onChange: (f: MultipartField[]) => void;
}) {
  const displayFields = useMemo<MultipartField[]>(
    () => [...fields, { kind: "text", enabled: true, name: "", value: "" }],
    [fields],
  );
  const trailingIdx = fields.length;

  function update(idx: number, patch: Partial<MultipartField>) {
    if (idx === trailingIdx) {
      const cur = displayFields[idx];
      // Merge patch and KEEP the existing kind to satisfy the discriminated union.
      const merged = { ...cur, ...patch } as MultipartField;
      onChange([...fields, merged]);
    } else {
      const next = fields.map((f, i) => (i === idx ? ({ ...f, ...patch } as MultipartField) : f));
      onChange(next);
    }
  }

  function toggleKind(idx: number) {
    const cur = displayFields[idx];
    const flipped: MultipartField =
      cur.kind === "text"
        ? { kind: "file", enabled: cur.enabled, name: cur.name, path: "", contentType: "" }
        : { kind: "text", enabled: cur.enabled, name: cur.name, value: "" };
    if (idx === trailingIdx) {
      onChange([...fields, flipped]);
    } else {
      onChange(fields.map((f, i) => (i === idx ? flipped : f)));
    }
  }

  function remove(idx: number) {
    if (idx === trailingIdx) return;
    onChange(fields.filter((_, i) => i !== idx));
  }

  async function pickFile(idx: number) {
    try {
      const picked = await openDialog({ multiple: false });
      if (typeof picked === "string") update(idx, { path: picked } as Partial<MultipartField>);
    } catch {
      /* user dismissed */
    }
  }

  const gridCols = "20px 1fr 60px 1.5fr 28px";

  return (
    <div className="flex flex-col">
      <div
        className="grid items-center gap-2 border-border/40 border-b px-1 py-1.5 font-mono font-semibold text-[10px] text-muted-foreground/70 tracking-[0.15em] uppercase"
        style={{ gridTemplateColumns: gridCols }}
      >
        <span aria-hidden="true" />
        <span>Name</span>
        <span>Type</span>
        <span>Value / File</span>
        <span aria-hidden="true" />
      </div>
      {displayFields.map((f, idx) => {
        const isTrailing = idx === trailingIdx;
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: multipart fields have no stable id
            key={idx}
            className={cn(
              "group/row grid items-center gap-2 px-1 py-1 transition-colors",
              "hover:bg-accent/30",
              !f.enabled && !isTrailing && "opacity-50",
              isTrailing && "opacity-60 hover:opacity-100",
            )}
            style={{ gridTemplateColumns: gridCols }}
          >
            <button
              type="button"
              aria-pressed={f.enabled}
              disabled={isTrailing}
              onClick={() =>
                !isTrailing && update(idx, { enabled: !f.enabled } as Partial<MultipartField>)
              }
              className={cn(
                "grid size-4 place-items-center rounded-sm border",
                isTrailing
                  ? "cursor-default border-dashed border-muted-foreground/30"
                  : f.enabled
                    ? "cursor-pointer border-primary bg-primary text-primary-foreground shadow-xs"
                    : "cursor-pointer border-border bg-background hover:border-primary/50",
              )}
            >
              {f.enabled && !isTrailing && (
                <svg viewBox="0 0 16 16" className="size-3" aria-hidden="true">
                  <path
                    d="M3 8.5l3 3 7-7"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </button>
            <Input
              value={f.name}
              onChange={(e) => update(idx, { name: e.target.value } as Partial<MultipartField>)}
              placeholder="field"
              className="h-7 cursor-text border-transparent bg-transparent px-2 font-mono text-xs shadow-none hover:border-border focus:border-ring"
            />
            <button
              type="button"
              disabled={isTrailing}
              onClick={() => toggleKind(idx)}
              className={cn(
                "h-7 rounded-sm border border-border bg-card px-2 font-mono text-[10px] tracking-wider uppercase transition-colors",
                isTrailing
                  ? "cursor-default text-muted-foreground/40"
                  : "cursor-pointer hover:border-primary/40 hover:text-foreground",
              )}
              title="Toggle text / file"
            >
              {f.kind}
            </button>
            {f.kind === "text" ? (
              <Input
                value={f.value}
                onChange={(e) => update(idx, { value: e.target.value } as Partial<MultipartField>)}
                placeholder="value"
                className="h-7 cursor-text border-transparent bg-transparent px-2 font-mono text-xs shadow-none hover:border-border focus:border-ring"
              />
            ) : (
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void pickFile(idx)}
                  className="h-7 cursor-pointer gap-1 px-2 text-xs"
                >
                  <FolderOpenIcon className="size-3" strokeWidth={1.75} aria-hidden="true" />
                  {f.path ? f.path.split(/[/\\]/).pop() : "Pick file…"}
                </Button>
              </div>
            )}
            {!isTrailing ? (
              <button
                type="button"
                onClick={() => remove(idx)}
                className="grid h-5 w-5 cursor-pointer place-items-center rounded-sm text-muted-foreground/40 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover/row:opacity-100"
                title="Remove field"
              >
                ×
              </button>
            ) : (
              <span aria-hidden="true" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function BinaryBody({
  path,
  contentType,
  onChange,
}: {
  path: string;
  contentType: string;
  onChange: (p: { path?: string; contentType?: string }) => void;
}) {
  async function pickFile() {
    try {
      const picked = await openDialog({ multiple: false });
      if (typeof picked === "string") onChange({ path: picked });
    } catch {
      /* user dismissed */
    }
  }

  const filename = path ? path.split(/[/\\]/).pop() : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label className="font-mono text-[10px] text-muted-foreground/70 tracking-wider uppercase">
          File
        </Label>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void pickFile()}
            className="cursor-pointer gap-1.5"
          >
            <FolderOpenIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            {filename ? "Change file…" : "Pick file…"}
          </Button>
          {filename && (
            <div className="flex min-w-0 flex-col text-xs">
              <span className="truncate font-mono text-foreground" title={path}>
                {filename}
              </span>
              <span
                className="truncate font-mono text-muted-foreground/70 text-[10px]"
                title={path}
              >
                {path}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label
          htmlFor="binary-ct"
          className="font-mono text-[10px] text-muted-foreground/70 tracking-wider uppercase"
        >
          Content-Type
        </Label>
        <Select value={contentType} onValueChange={(v) => onChange({ contentType: v })}>
          <SelectTrigger id="binary-ct" className="h-8 w-[280px] cursor-pointer text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BINARY_CONTENT_TYPES.map((ct) => (
              <SelectItem key={ct} value={ct} className="cursor-pointer font-mono text-xs">
                {ct}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function GraphQLBody({
  query,
  variables,
  onChange,
}: {
  query: string;
  variables: string;
  onChange: (p: { query?: string; variables?: string }) => void;
}) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-1 flex-col gap-1.5">
        <Label className="font-mono text-[10px] text-muted-foreground/70 tracking-wider uppercase">
          Query
        </Label>
        <CodeEditor
          value={query}
          onChange={(v) => onChange({ query: v })}
          language="graphql"
          placeholder="query GetUser($id: ID!) { user(id: $id) { name email } }"
          minHeight="180px"
          className="flex-1 min-h-0"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="flex items-center justify-between font-mono text-[10px] text-muted-foreground/70 tracking-wider uppercase">
          Variables
          <span className="font-sans normal-case text-muted-foreground/50">JSON</span>
        </Label>
        <CodeEditor
          value={variables}
          onChange={(v) => onChange({ variables: v })}
          language="json"
          placeholder='{ "id": "123" }'
          minHeight="120px"
        />
      </div>
    </div>
  );
}

export type { Body as BodyType, KvRow as KvFieldRow };
