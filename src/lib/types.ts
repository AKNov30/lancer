export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export type RequestBody =
  | { kind: "json"; value: unknown }
  | { kind: "text"; value: string; contentType: string }
  | { kind: "form"; fields: [string, string][] }
  | { kind: "none" };

export interface HttpRequest {
  url: string;
  method: Method;
  headers: [string, string][];
  query: [string, string][];
  body?: RequestBody;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: number[];
  bodyText?: string;
  elapsedMs: number;
  sizeBytes: number;
}
