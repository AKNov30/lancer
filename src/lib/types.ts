export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

/** Ordered list of supported HTTP methods. Drives the method picker render order. */
export const METHODS: readonly Method[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

/** Narrow an arbitrary string to a {@link Method}. */
export function isMethod(s: string): s is Method {
  return (METHODS as readonly string[]).includes(s);
}

/**
 * How a request connects. `"http"` is the classic one-shot request/response;
 * `"sse"` and `"websocket"` open a long-lived streaming connection whose
 * messages are shown in the stream panel instead of the response viewer.
 *
 * Defaults to `"http"` everywhere so existing tabs and `.bru` files (which
 * carry no `mode`) load and behave exactly as before.
 */
export type ConnectionMode = "http" | "sse" | "websocket" | "grpc";

/**
 * A key-value row that can be individually toggled on/off. Mirrors the
 * Bruno `.bru` schema so editor state survives round-trip to disk.
 *
 * Wire format to Rust still uses `[string, string][]` for compatibility;
 * convert with {@link kvRowsToTuples} at the send boundary.
 */
export interface KvRow {
  enabled: boolean;
  key: string;
  value: string;
  description?: string;
}

export function kvRowsToTuples(rows: KvRow[]): [string, string][] {
  return rows.filter((r) => r.enabled && r.key.trim().length > 0).map((r) => [r.key, r.value]);
}

export function tuplesToKvRows(tuples: [string, string][]): KvRow[] {
  return tuples.map(([key, value]) => ({ enabled: true, key, value }));
}

// ─── Body types ──────────────────────────────────────────────────────────────

/**
 * One field in a multipart/form-data body. Each part may be either a text
 * field or a file picked from disk; per-part enable toggle lets users keep
 * disabled rows in the editor without losing them.
 */
export type MultipartField =
  | { kind: "text"; enabled: boolean; name: string; value: string }
  | {
      kind: "file";
      enabled: boolean;
      name: string;
      path: string;
      contentType: string;
    };

/**
 * Editable body shape kept in the request store. Distinct from the wire
 * {@link RequestBody} so the editor can carry richer state (multipart with
 * files, GraphQL query+variables panes, raw text with content-type select).
 */
export type Body =
  | { kind: "none" }
  | { kind: "json"; text: string }
  | { kind: "raw"; text: string; contentType: string }
  | { kind: "form"; fields: KvRow[] }
  | { kind: "multipart"; fields: MultipartField[] }
  | { kind: "binary"; path: string; contentType: string }
  | { kind: "graphql"; query: string; variables: string };

/**
 * One part of a wire-side multipart body. Internally tagged on `kind` to match
 * the Rust `MultipartPart` enum (`#[serde(tag = "kind")]`, camelCase). A `text`
 * part sends an inline value; a `file` part is read from `path` by the Rust
 * client, with an optional `contentType` override (empty → sniffed by ext).
 */
export type WireMultipartPart =
  | { kind: "text"; name: string; value: string }
  | { kind: "file"; name: string; path: string; contentType: string };

/** A request body in the form the Rust wire layer accepts. */
export type RequestBody =
  | { kind: "json"; value: unknown }
  | { kind: "text"; value: string; contentType: string }
  | { kind: "form"; fields: [string, string][] }
  | { kind: "multipart"; parts: WireMultipartPart[] }
  | { kind: "binary"; path: string; contentType: string }
  | { kind: "none" };

/**
 * Convert a wire-side {@link RequestBody} (e.g. from cURL parse) into the
 * editor-side {@link Body} so the Body tab can hydrate from imported data.
 */
export function wireBodyToEditor(wire: RequestBody | undefined | null): Body {
  if (!wire || wire.kind === "none") return { kind: "none" };
  switch (wire.kind) {
    case "json":
      return {
        kind: "json",
        // Wire `json` holds parsed JSON; convert back to text for the editor.
        text: typeof wire.value === "string" ? wire.value : JSON.stringify(wire.value, null, 2),
      };
    case "text":
      // Heuristic: text+json content type → show as JSON tab for syntax help.
      if (wire.contentType.toLowerCase().includes("json")) {
        return { kind: "json", text: wire.value };
      }
      return { kind: "raw", text: wire.value, contentType: wire.contentType };
    case "form":
      return {
        kind: "form",
        fields: wire.fields.map(([key, value]) => ({ enabled: true, key, value })),
      };
    case "multipart":
      return {
        kind: "multipart",
        fields: wire.parts.map((p) =>
          p.kind === "text"
            ? { kind: "text", enabled: true, name: p.name, value: p.value }
            : {
                kind: "file",
                enabled: true,
                name: p.name,
                path: p.path,
                contentType: p.contentType,
              },
        ),
      };
    case "binary":
      return { kind: "binary", path: wire.path, contentType: wire.contentType };
  }
}

/**
 * Convert an editor-side {@link Body} into the wire-side {@link RequestBody}.
 * Every body kind is now sendable; the `undefined` return is retained in the
 * signature for callers that still guard on it (none currently produce it).
 */
export function bodyToWire(body: Body): RequestBody | undefined {
  switch (body.kind) {
    case "none":
      return { kind: "none" };
    case "json":
      return { kind: "text", value: body.text, contentType: "application/json" };
    case "raw":
      return {
        kind: "text",
        value: body.text,
        contentType: body.contentType || "text/plain",
      };
    case "form":
      return { kind: "form", fields: kvRowsToTuples(body.fields) };
    case "binary":
      return { kind: "binary", path: body.path, contentType: body.contentType };
    case "graphql": {
      let variables: unknown = {};
      if (body.variables.trim()) {
        try {
          variables = JSON.parse(body.variables);
        } catch {
          // Send as string if not valid JSON.
          variables = body.variables;
        }
      }
      return {
        kind: "text",
        value: JSON.stringify({ query: body.query, variables }),
        contentType: "application/json",
      };
    }
    case "multipart": {
      // Drop disabled rows and unnamed rows (mirrors `kvRowsToTuples`, which
      // filters disabled + empty-key form fields). Each surviving row maps to
      // an internally-tagged wire part the Rust client understands.
      const parts: WireMultipartPart[] = body.fields
        .filter((f) => f.enabled && f.name.trim().length > 0)
        .map((f) =>
          f.kind === "text"
            ? { kind: "text", name: f.name, value: f.value }
            : { kind: "file", name: f.name, path: f.path, contentType: f.contentType },
        );
      return { kind: "multipart", parts };
    }
  }
}

/** Per-request HTTP-level overrides. All fields optional → use server default. */
export interface RequestOptions {
  /** Per-request timeout in ms (overrides global default of 30s) */
  timeoutMs?: number | null;
  /** Whether to follow HTTP redirects automatically (default true) */
  followRedirects?: boolean | null;
  /** Max redirects to follow (default 10) */
  maxRedirects?: number | null;
  /** Skip TLS certificate verification (DANGEROUS — opt-in per request) */
  insecureSkipVerify?: boolean | null;
}

export interface HttpRequest {
  url: string;
  method: Method;
  headers: [string, string][];
  query: [string, string][];
  body?: RequestBody;
  options?: RequestOptions | null;
}

/**
 * One assertion result from a post-response script's `lancer.test(...)` block.
 * Mirrors the Rust `scripting::TestResult`.
 */
export interface TestResult {
  name: string;
  passed: boolean;
  /** Failure message when `passed` is false; absent on success. */
  error?: string | null;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: number[];
  bodyText?: string;
  elapsedMs: number;
  sizeBytes: number;
  /** Time-to-first-byte: DNS + connect + TLS + initial server response (ms). */
  ttfbMs?: number;
  /** Body download time after headers received (ms). */
  downloadMs?: number;
  /** Assertion results from the post-response script (empty if none ran). */
  tests?: TestResult[];
  /** console.log / lancer.log output from pre- and post-response scripts. */
  scriptLogs?: string[];
  /** Hard error from a script (syntax/uncaught) — the HTTP request still ran. */
  scriptError?: string | null;
}

export type Auth =
  | { kind: "none" }
  | { kind: "bearer"; token: string }
  | { kind: "basic"; username: string; password: string }
  | { kind: "apiKey"; key: string; value: string; in: string }
  | {
      kind: "oAuth2Cc";
      tokenUrl: string;
      clientId: string;
      clientSecret: string;
      scope: string;
      audience: string;
    }
  | {
      kind: "awsSigV4";
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken?: string | null;
      region: string;
      service: string;
    };
