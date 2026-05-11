import { invoke } from "@tauri-apps/api/core";
import type { Auth, HttpRequest, HttpResponse, Method } from "@/lib/types";

export interface SendOptions {
  workspaceRoot?: string | null;
  envName?: string | null;
}

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
  | { kind: "graphQl"; query: string; variables: string };

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
}

export interface WorkspaceItem {
  path: string;
  relPath: string;
  name: string;
  method: string;
  seq: number | null;
}

export const listWorkspace = (root: string): Promise<WorkspaceItem[]> =>
  invoke<WorkspaceItem[]>("list_workspace", { root });

export const readRequest = (path: string): Promise<CollectionRequest> =>
  invoke<CollectionRequest>("read_request", { path });

export const writeRequest = (path: string, req: CollectionRequest): Promise<void> =>
  invoke<void>("write_request", { path, req });

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
