import { Channel, invoke } from "@tauri-apps/api/core";
import type { Auth, HttpRequest, HttpResponse, Method } from "@/lib/types";

export interface SendOptions {
  workspaceRoot?: string | null;
  envName?: string | null;
  /** Path to the saved .bru file — used to resolve folder.bru chain. */
  requestPath?: string | null;
  /** Runtime overlay vars (e.g. post-response captures) applied on top of the env file. */
  extraVars?: Array<[string, string]> | null;
  /** Pre-request JS script — runs before sending, may set vars via lancer.env.set(). */
  preRequestScript?: string | null;
  /** Post-response JS script — runs after the response, may assert via lancer.test(). */
  postResponseScript?: string | null;
  /** Opaque id (e.g. crypto.randomUUID()) used to cancel this request mid-flight
   * via {@link cancelRequest}. Omit to make the request non-cancellable. */
  requestId?: string | null;
}

/** Error string the backend returns when a request is aborted via
 * {@link cancelRequest}. Recognise this to show a neutral cancelled message
 * rather than a network error. */
export const CANCELLED_SENTINEL = "__cancelled__";

export async function sendRequest(
  req: HttpRequest,
  auth?: Auth | null,
  opts?: SendOptions,
): Promise<HttpResponse> {
  return invoke<HttpResponse>("send_request", {
    req,
    auth: auth ?? null,
    workspaceRoot: opts?.workspaceRoot ?? null,
    envName: opts?.envName ?? null,
    requestPath: opts?.requestPath ?? null,
    extraVars: opts?.extraVars ?? null,
    preRequestScript: opts?.preRequestScript ?? null,
    postResponseScript: opts?.postResponseScript ?? null,
    requestId: opts?.requestId ?? null,
  });
}

/** Abort an in-flight request previously started with `opts.requestId`.
 * Best-effort: a no-op if the request already finished. The awaited
 * {@link sendRequest} then rejects with {@link CANCELLED_SENTINEL}. */
export async function cancelRequest(requestId: string): Promise<void> {
  return invoke<void>("cancel_request", { requestId });
}

export interface ResolvedVar {
  name: string;
  value: string;
  source: "folder" | "env" | "overlay" | "secret";
  isSecret: boolean;
}

/** Resolve the active variable context (folder chain + env + overlay) for the
 * "resolved value" preview. Mirrors send_request's precedence. */
export function resolveVars(opts: SendOptions): Promise<ResolvedVar[]> {
  return invoke<ResolvedVar[]>("resolve_vars", {
    workspaceRoot: opts.workspaceRoot ?? null,
    envName: opts.envName ?? null,
    requestPath: opts.requestPath ?? null,
    extraVars: opts.extraVars ?? null,
  });
}

export interface KvEnabled {
  key: string;
  value: string;
  enabled: boolean;
}

export type CollectionRequestBody =
  | { kind: "json"; value: string }
  | { kind: "text"; value: string; contentType: string }
  | { kind: "formUrlencoded"; fields: KvEnabled[] }
  | { kind: "multipartForm"; fields: KvEnabled[] }
  | { kind: "graphQl"; query: string; variables: string }
  | { kind: "binary"; path: string; contentType: string };

// CollectionAuth is the same domain as Auth (in src/lib/types.ts).
// Aliased so a single source of truth covers both stored .bru files and in-flight requests.
export type CollectionAuth = Auth;

export interface CollectionRequest {
  name: string;
  seq: number | null;
  method: Method;
  url: string;
  headers: KvEnabled[];
  params: KvEnabled[];
  body: CollectionRequestBody | null;
  auth: CollectionAuth | null;
  vars: KvEnabled[];
  /** Pre-request JS, persisted to `.bru` as a `script:pre-request` block. */
  preRequestScript?: string | null;
  /** Post-response JS, persisted to `.bru` as `script:post-response`. */
  postResponseScript?: string | null;
}

export interface WorkspaceItem {
  /** `"file"` for `.bru` requests, `"folder"` for directories. */
  kind: "file" | "folder";
  path: string;
  relPath: string;
  name: string;
  /** Empty string for folders. */
  method: string;
  seq: number | null;
}

export const listWorkspace = (root: string): Promise<WorkspaceItem[]> =>
  invoke<WorkspaceItem[]>("list_workspace", { root });

export const readRequest = (path: string): Promise<CollectionRequest> =>
  invoke<CollectionRequest>("read_request", { path });

export const writeRequest = (path: string, req: CollectionRequest): Promise<void> =>
  invoke<void>("write_request", { path, req });

export const renamePath = (from: string, to: string): Promise<void> =>
  invoke<void>("rename_path", { from, to });

export const deletePath = (path: string): Promise<void> => invoke<void>("delete_path", { path });

export const createFolder = (parent: string, name: string): Promise<string> =>
  invoke<string>("create_folder", { parent, name });

export const moveItem = (from: string, toParent: string): Promise<string> =>
  invoke<string>("move_item", { from, toParent });

/** Resolve `<Documents>/Lancer` — the default home for app-managed workspaces. */
export const defaultWorkspaceRoot = (): Promise<string> => invoke<string>("default_workspace_root");

/** Create a new workspace folder by name (no path picker required). */
export const createNamedWorkspace = (name: string): Promise<string> =>
  invoke<string>("create_named_workspace", { name });

/** Duplicate a file or folder. Returns the path of the new copy. */
export const duplicatePath = (path: string): Promise<string> =>
  invoke<string>("duplicate_path", { path });

// ─── Workspace export ─────────────────────────────────────────────────────

/** Result of a workspace zip export. Mirrors the Rust `ExportReport`. */
export interface ExportReport {
  /** Total file entries written to the archive. */
  fileCount: number;
  /** `.bru` files in which at least one literal auth secret was redacted. */
  redactedFiles: number;
}

/** Pack selected top-level folders into a .zip archive. */
export const exportWorkspaceZip = (
  workspaceRoot: string,
  selectedFolders: string[],
  includeEnvironments: boolean,
  dest: string,
): Promise<ExportReport> =>
  invoke<ExportReport>("export_workspace_zip", {
    workspaceRoot,
    selectedFolders,
    includeEnvironments,
    dest,
  });

/** List top-level folders under workspace (excluding environments + hidden). */
export const listTopLevelFolders = (workspaceRoot: string): Promise<string[]> =>
  invoke<string[]>("list_top_level_folders", { workspaceRoot });

// ─── Folder (collection) settings ─────────────────────────────────────────

export interface FolderSettings {
  vars: KvEnabled[];
  name: string;
  /** Free-text / markdown collection description (the `docs { }` block). */
  description: string;
  /** Collection default Authorization. Requests inside this folder with no
   * explicit auth inherit the nearest ancestor folder's auth. `null` = none. */
  auth: CollectionAuth | null;
}

export const readFolderSettings = (folderPath: string): Promise<FolderSettings> =>
  invoke<FolderSettings>("read_folder_settings", { folderPath });

export const writeFolderSettings = (folderPath: string, settings: FolderSettings): Promise<void> =>
  invoke<void>("write_folder_settings", { folderPath, settings });

// ─── File-system watcher ─────────────────────────────────────────────────────

/** Start the workspace file watcher. Emits `workspace://changed` events. */
export const startWatching = (root: string): Promise<void> =>
  invoke<void>("start_watching", { root });

export const stopWatching = (): Promise<void> => invoke<void>("stop_watching");

export const pathInWorkspace = (path: string, root: string): Promise<boolean> =>
  invoke<boolean>("path_in_workspace", { path, root });

export interface Environment {
  name: string;
  vars: [string, string][];
  secretNames: string[];
}

export const listEnvs = (workspaceRoot: string): Promise<string[]> =>
  invoke<string[]>("list_envs", { workspaceRoot });

export const readEnv = (workspaceRoot: string, name: string): Promise<Environment> =>
  invoke<Environment>("read_env", { workspaceRoot, name });

export const writeEnv = (workspaceRoot: string, env: Environment): Promise<void> =>
  invoke<void>("write_env", { workspaceRoot, env });

export const deleteEnv = (workspaceRoot: string, name: string): Promise<void> =>
  invoke<void>("delete_env", { workspaceRoot, name });

export const getSecret = (
  workspaceRoot: string,
  envName: string,
  varName: string,
): Promise<string | null> =>
  invoke<string | null>("get_secret", { workspaceRoot, envName, varName });

export const setSecret = (
  workspaceRoot: string,
  envName: string,
  varName: string,
  value: string,
): Promise<void> => invoke<void>("set_secret", { workspaceRoot, envName, varName, value });

export const deleteSecret = (
  workspaceRoot: string,
  envName: string,
  varName: string,
): Promise<void> => invoke<void>("delete_secret", { workspaceRoot, envName, varName });

// ─── Postman importer ────────────────────────────────────────────────────────

export interface PostmanImportReport {
  created: string[];
  skippedExisting: string[];
  warnings: string[];
  errors: string[];
}

export const importPostman = (
  collectionPath: string,
  destRoot: string,
): Promise<PostmanImportReport> =>
  invoke<PostmanImportReport>("import_postman", { collectionPath, destRoot });

export const importPostmanEnv = (envPath: string, workspaceRoot: string): Promise<string> =>
  invoke<string>("import_postman_env", { envPath, workspaceRoot });

// ─── OpenAPI importer ─────────────────────────────────────────────────────────

export interface OpenApiImportReport {
  createdFiles: string[];
  skippedExisting: string[];
  errors: string[];
  envCreated: string | null;
}

export const importOpenapi = (specPath: string, destRoot: string): Promise<OpenApiImportReport> =>
  invoke<OpenApiImportReport>("import_openapi", { specPath, destRoot });

/** Sniff a file's content to detect its format. Returns one of:
 *  `"postman"` | `"postman-env"` | `"openapi"` | `"unknown"` */
export const detectFileFormat = (path: string): Promise<string> =>
  invoke<string>("detect_file_format", { path });

// ─── Mock server ──────────────────────────────────────────────────────────────

export interface MockStatus {
  running: boolean;
  port: number | null;
  specPath: string | null;
  error: string | null;
}

export const mockStart = (specPath: string, port: number): Promise<MockStatus> =>
  invoke<MockStatus>("mock_start", { specPath, port });

export const mockStop = (): Promise<MockStatus> => invoke<MockStatus>("mock_stop");

export const mockStatus = (): Promise<MockStatus> => invoke<MockStatus>("mock_status");

// ─── History ──────────────────────────────────────────────────────────────────

export interface HistoryEntry {
  id: number;
  timestamp: number;
  url: string;
  method: string;
  status: number;
  elapsedMs: number;
  sizeBytes: number;
  headersJson: string;
  bodyTextPreview: string | null;
  pinned: boolean;
}

export const historyList = (limit?: number): Promise<HistoryEntry[]> =>
  invoke<HistoryEntry[]>("history_list", { limit: limit ?? 100 });

export const historySearch = (query: string, limit?: number): Promise<HistoryEntry[]> =>
  invoke<HistoryEntry[]>("history_search", { query, limit: limit ?? 100 });

export const historyPin = (id: number, pinned: boolean): Promise<void> =>
  invoke<void>("history_pin", { id, pinned });

export const historyClear = (): Promise<void> => invoke<void>("history_clear");

// ─── Filesystem ────────────────────────────────────────────────────────────────

/** Write a byte buffer to a user-chosen path. */
export const saveBytes = (path: string, content: number[]): Promise<void> =>
  invoke<void>("save_bytes", { path, content });

// ─── Global settings (proxy, etc.) ────────────────────────────────────────────

export interface ProxyConfig {
  enabled: boolean;
  /** e.g. `http://proxy.corp.local:8080` or `socks5://1.2.3.4:1080` */
  url: string;
  username: string;
  password: string;
  /**
   * Backend-managed flag: whether a proxy password is stored in the OS
   * keyring. Read-only from the frontend's perspective — the cleartext
   * `password` round-trips through the keyring transparently.
   */
  passwordSet?: boolean;
  /** Comma-separated host patterns to bypass */
  noProxy: string;
}

export interface AppSettings {
  proxy: ProxyConfig;
}

export const getSettings = (): Promise<AppSettings> => invoke<AppSettings>("get_settings");
export const setSettings = (settings: AppSettings): Promise<void> =>
  invoke<void>("set_settings", { settings });

// ─── cURL import / export ────────────────────────────────────────────────────

export const parseCurl = (input: string): Promise<HttpRequest> =>
  invoke<HttpRequest>("parse_curl", { input });

export const exportCurl = (req: HttpRequest): Promise<string> =>
  invoke<string>("export_curl", { req });

export const exportFetch = (req: HttpRequest): Promise<string> =>
  invoke<string>("export_fetch", { req });

export const exportAxios = (req: HttpRequest): Promise<string> =>
  invoke<string>("export_axios", { req });

export const exportPython = (req: HttpRequest): Promise<string> =>
  invoke<string>("export_python", { req });

export const exportGo = (req: HttpRequest): Promise<string> => invoke<string>("export_go", { req });

// ─── Cookie jar ────────────────────────────────────────────────────────────────

/** One stored cookie, mirrors the Rust `CookieInfo` (serde camelCase). */
export interface CookieInfo {
  domain: string;
  name: string;
  value: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  /** RFC3339 UTC expiry for persistent cookies; `null` for session cookies. */
  expires: string | null;
}

/** List every cookie currently in the shared HTTP cookie jar. */
export const listCookies = (): Promise<CookieInfo[]> => invoke<CookieInfo[]>("list_cookies");

/** Insert or update a cookie. Keyed by (domain, path, name) — re-setting overwrites. */
export const setCookie = (
  domain: string,
  name: string,
  value: string,
  path: string,
  secure: boolean,
  httpOnly: boolean,
): Promise<void> => invoke<void>("set_cookie", { domain, name, value, path, secure, httpOnly });

/** Remove a single cookie identified by (domain, name, path). */
export const deleteCookie = (domain: string, name: string, path: string): Promise<void> =>
  invoke<void>("delete_cookie", { domain, name, path });

/** Empty the entire cookie jar. */
export const clearCookies = (): Promise<void> => invoke<void>("clear_cookies");

// ─── Real-time streaming (SSE / WebSocket) ─────────────────────────────────────

/**
 * One message streamed from a live connection. Mirrors the Rust `StreamMsg`.
 * `kind` is `"open" | "message" | "sent" | "close" | "error"`.
 */
export interface StreamMsg {
  kind: "open" | "message" | "sent" | "close" | "error";
  data: string;
  /** SSE event name (e.g. `ping`), when present. */
  event?: string;
  /** SSE last-event-id, when present. */
  id?: string;
  /** Unix epoch milliseconds. */
  ts: number;
}

/**
 * Open an SSE connection. `onEvent` fires for each parsed event (plus
 * open/close/error). Resolves with the connection id used by {@link disconnect}.
 */
export const sseConnect = (
  url: string,
  headers: Array<[string, string]>,
  onEvent: (msg: StreamMsg) => void,
): Promise<string> => {
  const channel = new Channel<StreamMsg>();
  channel.onmessage = onEvent;
  return invoke<string>("sse_connect", { url, headers, onEvent: channel });
};

/**
 * Open a WebSocket connection. `onEvent` fires for open/message/sent/close/error.
 * Resolves with the connection id used by {@link wsSend} / {@link disconnect}.
 */
export const wsConnect = (
  url: string,
  headers: Array<[string, string]>,
  onEvent: (msg: StreamMsg) => void,
): Promise<string> => {
  const channel = new Channel<StreamMsg>();
  channel.onmessage = onEvent;
  return invoke<string>("ws_connect", { url, headers, onEvent: channel });
};

/** Send a text frame over an open WebSocket connection. */
export const wsSend = (connectionId: string, text: string): Promise<void> =>
  invoke<void>("ws_send", { connectionId, text });

/** Close a streaming connection (SSE or WebSocket). No-op if already gone. */
export const disconnect = (connectionId: string): Promise<void> =>
  invoke<void>("disconnect", { connectionId });

// ─── gRPC (runtime .proto loading, unary calls) ────────────────────────────

/** One RPC method enumerated from a parsed `.proto`. Mirrors Rust `GrpcMethod`. */
export interface GrpcMethod {
  /** Fully-qualified service name, e.g. `greet.Greeter`. */
  service: string;
  /** Bare method name, e.g. `SayHello`. */
  method: string;
  clientStreaming: boolean;
  serverStreaming: boolean;
  /** Fully-qualified input message type. */
  inputType: string;
  /** Fully-qualified output message type. */
  outputType: string;
}

/** Result of a unary gRPC call. Mirrors Rust `GrpcResponse`. */
export interface GrpcResponse {
  /** Numeric gRPC status code (0 = OK). */
  statusCode: number;
  /** Status message — `"OK"` on success, otherwise the server detail. */
  message: string;
  /** Decoded response message as pretty JSON; empty when statusCode != 0. */
  bodyJson: string;
  /** Wall-clock time for the call in ms. */
  timeMs: number;
}

/** Parse a `.proto` file and list every RPC method across its services. */
export const grpcListMethods = (protoPath: string): Promise<GrpcMethod[]> =>
  invoke<GrpcMethod[]>("grpc_list_methods", { protoPath });

/**
 * Invoke a unary gRPC method with a JSON request body. A non-OK gRPC status is
 * returned inside the result (statusCode != 0) rather than thrown, so the UI
 * can show it like a normal response. Throws only on parse/transport failure.
 */
export const grpcUnaryCall = (args: {
  protoPath: string;
  endpoint: string;
  service: string;
  method: string;
  jsonBody: string;
  metadata: Array<[string, string]>;
  /** Opaque id (e.g. crypto.randomUUID()) used to cancel this call mid-flight
   * via {@link cancelRequest}. Omit to make the call non-cancellable. */
  requestId?: string | null;
}): Promise<GrpcResponse> =>
  invoke<GrpcResponse>("grpc_unary_call", {
    protoPath: args.protoPath,
    endpoint: args.endpoint,
    service: args.service,
    method: args.method,
    jsonBody: args.jsonBody,
    metadata: args.metadata,
    requestId: args.requestId ?? null,
  });
