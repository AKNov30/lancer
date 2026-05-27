/**
 * Convert a Lancer workspace (a list of WorkspaceItem files) into a Postman
 * v2.1 collection JSON. Folder hierarchy mirrors `.bru` directory structure.
 *
 * Spec reference: https://schema.postman.com/collection/json/v2.1.0/draft/docs/index.html
 */
import {
  type CollectionAuth,
  type CollectionRequest,
  readRequest,
  type WorkspaceItem,
} from "@/lib/tauri";

interface PostmanCollection {
  info: {
    name: string;
    description?: string;
    schema: string;
    _exporter: string;
  };
  item: PostmanItem[];
  /** Collection-level variables — Postman renders these in the Variables tab. */
  variable?: { key: string; value: string; disabled?: boolean }[];
}

type PostmanItem = PostmanFolderItem | PostmanRequestItem;

interface PostmanFolderItem {
  name: string;
  item: PostmanItem[];
}

interface PostmanRequestItem {
  name: string;
  request: {
    method: string;
    header: { key: string; value: string; disabled?: boolean }[];
    url:
      | string
      | {
          raw: string;
          host?: string[];
          path?: string[];
          query?: { key: string; value: string; disabled?: boolean }[];
        };
    body?:
      | { mode: "raw"; raw: string; options?: { raw: { language: string } } }
      | { mode: "urlencoded"; urlencoded: { key: string; value: string; disabled?: boolean }[] }
      | {
          mode: "formdata";
          formdata: { key: string; value: string; type: "text"; disabled?: boolean }[];
        }
      | { mode: "graphql"; graphql: { query: string; variables: string } }
      | { mode: "file"; file: { src: string } };
    auth?: PostmanAuth;
  };
  variable?: { key: string; value: string; disabled?: boolean }[];
}

/**
 * Postman v2.1 auth shape. Keys vary per `type` so we serialise the relevant
 * sub-fields only — extra keys aren't rejected by Postman but they bloat the
 * file.
 */
type PostmanAuth =
  | { type: "noauth" }
  | { type: "bearer"; bearer: { key: "token"; value: string; type: "string" }[] }
  | {
      type: "basic";
      basic: { key: "username" | "password"; value: string; type: "string" }[];
    }
  | {
      type: "apikey";
      apikey: { key: "key" | "value" | "in"; value: string; type: "string" }[];
    }
  | {
      type: "oauth2";
      oauth2: { key: string; value: string; type: "string" }[];
    }
  | {
      type: "awsv4";
      awsv4: { key: string; value: string; type: "string" }[];
    };

function authToPostman(a: CollectionAuth | null): PostmanAuth | undefined {
  if (!a || a.kind === "none") return undefined;
  switch (a.kind) {
    case "bearer":
      return {
        type: "bearer",
        bearer: [{ key: "token", value: a.token, type: "string" }],
      };
    case "basic":
      return {
        type: "basic",
        basic: [
          { key: "username", value: a.username, type: "string" },
          { key: "password", value: a.password, type: "string" },
        ],
      };
    case "apiKey":
      return {
        type: "apikey",
        apikey: [
          { key: "key", value: a.key, type: "string" },
          { key: "value", value: a.value, type: "string" },
          // Postman uses `in: "header" | "query"` — pass through.
          { key: "in", value: a.in, type: "string" },
        ],
      };
    case "oAuth2Cc":
      return {
        type: "oauth2",
        oauth2: [
          { key: "grant_type", value: "client_credentials", type: "string" },
          { key: "accessTokenUrl", value: a.tokenUrl, type: "string" },
          { key: "clientId", value: a.clientId, type: "string" },
          { key: "clientSecret", value: a.clientSecret, type: "string" },
          { key: "scope", value: a.scope, type: "string" },
          { key: "audience", value: a.audience, type: "string" },
        ],
      };
    case "awsSigV4":
      return {
        type: "awsv4",
        awsv4: [
          { key: "accessKey", value: a.accessKeyId, type: "string" },
          { key: "secretKey", value: a.secretAccessKey, type: "string" },
          { key: "sessionToken", value: a.sessionToken ?? "", type: "string" },
          { key: "region", value: a.region, type: "string" },
          { key: "service", value: a.service, type: "string" },
        ],
      };
  }
}

function toPostmanRequest(name: string, req: CollectionRequest): PostmanRequestItem {
  const header = req.headers.map((h) => ({
    key: h.key,
    value: h.value,
    ...(h.enabled ? {} : { disabled: true }),
  }));

  const query = req.params.map((p) => ({
    key: p.key,
    value: p.value,
    ...(p.enabled ? {} : { disabled: true }),
  }));

  let body: PostmanRequestItem["request"]["body"];
  if (req.body) {
    switch (req.body.kind) {
      case "json":
        body = {
          mode: "raw",
          raw: req.body.value,
          options: { raw: { language: "json" } },
        };
        break;
      case "text":
        body = { mode: "raw", raw: req.body.value };
        break;
      case "formUrlencoded":
        body = {
          mode: "urlencoded",
          urlencoded: req.body.fields.map((f) => ({
            key: f.key,
            value: f.value,
            ...(f.enabled ? {} : { disabled: true }),
          })),
        };
        break;
      case "multipartForm":
        body = {
          mode: "formdata",
          formdata: req.body.fields.map((f) => ({
            key: f.key,
            value: f.value,
            type: "text" as const,
            ...(f.enabled ? {} : { disabled: true }),
          })),
        };
        break;
      case "graphQl":
        body = {
          mode: "graphql",
          graphql: { query: req.body.query, variables: req.body.variables },
        };
        break;
      case "binary":
        body = { mode: "file", file: { src: req.body.path } };
        break;
    }
  }

  const auth = authToPostman(req.auth);
  const variable = req.vars
    .filter((v) => v.key.trim().length > 0)
    .map((v) => ({
      key: v.key,
      value: v.value,
      ...(v.enabled ? {} : { disabled: true }),
    }));

  return {
    name,
    request: {
      method: req.method,
      header,
      url: query.length > 0 ? { raw: req.url, query } : req.url,
      ...(body ? { body } : {}),
      ...(auth ? { auth } : {}),
    },
    ...(variable.length > 0 ? { variable } : {}),
  };
}

interface TreeNode {
  name: string;
  /** Children keyed by name to preserve filesystem hierarchy */
  folders: Map<string, TreeNode>;
  files: WorkspaceItem[];
}

function buildTree(items: WorkspaceItem[]): TreeNode {
  const root: TreeNode = { name: "", folders: new Map(), files: [] };
  for (const it of items) {
    if (it.kind !== "file") continue;
    const parts = it.relPath.replace(/\\/g, "/").split("/").filter(Boolean);
    let cursor = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      let next = cursor.folders.get(seg);
      if (!next) {
        next = { name: seg, folders: new Map(), files: [] };
        cursor.folders.set(seg, next);
      }
      cursor = next;
    }
    cursor.files.push(it);
  }
  return root;
}

async function nodeToItems(node: TreeNode): Promise<PostmanItem[]> {
  const out: PostmanItem[] = [];
  // Folders first, alphabetised — matches the sidebar order.
  const folderNames = Array.from(node.folders.keys()).sort();
  for (const name of folderNames) {
    const child = node.folders.get(name);
    if (!child) continue;
    out.push({ name, item: await nodeToItems(child) });
  }
  // Then files in the same alphabetical order.
  const sortedFiles = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  for (const f of sortedFiles) {
    try {
      const req = await readRequest(f.path);
      out.push(toPostmanRequest(f.name, req));
    } catch (e) {
      console.error("export skip (parse failed)", f.path, e);
    }
  }
  return out;
}

/**
 * Build a Postman v2.1 collection JSON string for the supplied workspace
 * items. Pure helper — caller is responsible for picking a save location.
 */
export async function workspaceToPostmanJson(
  workspaceName: string,
  items: WorkspaceItem[],
): Promise<string> {
  const tree = buildTree(items);
  const collection: PostmanCollection = {
    info: {
      name: workspaceName,
      description: "Exported from Lancer",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      _exporter: "Lancer",
    },
    item: await nodeToItems(tree),
  };
  return JSON.stringify(collection, null, 2);
}
