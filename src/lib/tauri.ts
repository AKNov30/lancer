import { invoke } from "@tauri-apps/api/core";
import type { HttpRequest, HttpResponse, Method } from "@/lib/types";

export async function sendRequest(req: HttpRequest): Promise<HttpResponse> {
  return invoke<HttpResponse>("send_request", { req });
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

export type CollectionAuth =
  | { kind: "none" }
  | { kind: "bearer"; token: string }
  | { kind: "basic"; username: string; password: string }
  | { kind: "apiKey"; key: string; value: string; in: string };

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
