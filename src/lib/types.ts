export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export type RequestBody =
  | { kind: "json"; value: unknown }
  | { kind: "text"; value: string; contentType: string }
  | { kind: "form"; fields: [string, string][] }
  | { kind: "binary"; path: string; contentType: string }
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
