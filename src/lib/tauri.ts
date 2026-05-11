import { invoke } from "@tauri-apps/api/core";
import type { Auth, HttpRequest, HttpResponse, Method } from "@/lib/types";

export async function sendRequest(req: HttpRequest, auth?: Auth | null): Promise<HttpResponse> {
  return invoke<HttpResponse>("send_request", { req, auth: auth ?? null });
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
