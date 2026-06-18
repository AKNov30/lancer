//! Converters between the editor-side {@link RequestForm} + {@link Body}
//! and the on-disk Bruno `.bru` schema represented by {@link CollectionRequest}.
//!
//! These are kept in their own module because they sit at a TS↔Rust boundary
//! and otherwise pollute either the request-store (TS state) or tauri.ts
//! (wire types). Keeping them isolated makes it easy to test the mapping
//! in one place.

import type { CollectionRequest, CollectionRequestBody, KvEnabled } from "@/lib/tauri";
import type { Auth, Body, KvRow, MultipartField } from "@/lib/types";

function kvRowsToKvEnabled(rows: KvRow[]): KvEnabled[] {
  return rows.map((r) => ({ key: r.key, value: r.value, enabled: r.enabled }));
}

/**
 * Multipart file parts are stored in a `.bru` `body:multipart-form` k-v block
 * the same way Bruno does it: the field value is `@file(<path>)`, optionally
 * suffixed with `@contentType(<mime>)`. This lets text + file parts share one
 * `Vec<KvEnabled>` row list with no schema change, and survives the Rust
 * serialize↔parse round-trip verbatim (the value is just a string there).
 */
const FILE_PART_RE = /^@file\((.*?)\)(?:@contentType\((.*)\))?$/;

function encodeMultipartValue(field: MultipartField): string {
  if (field.kind === "text") return field.value;
  const ct = field.contentType.trim();
  return ct ? `@file(${field.path})@contentType(${ct})` : `@file(${field.path})`;
}

function decodeMultipartField(kv: KvEnabled): MultipartField {
  const matched = FILE_PART_RE.exec(kv.value);
  if (matched) {
    return {
      kind: "file",
      enabled: kv.enabled,
      name: kv.key,
      path: matched[1],
      contentType: matched[2] ?? "",
    };
  }
  return { kind: "text", enabled: kv.enabled, name: kv.key, value: kv.value };
}

export function bodyToCollection(body: Body): CollectionRequestBody | null {
  switch (body.kind) {
    case "none":
      return null;
    case "json":
      return { kind: "json", value: body.text };
    case "raw":
      return { kind: "text", value: body.text, contentType: body.contentType };
    case "form":
      return { kind: "formUrlencoded", fields: kvRowsToKvEnabled(body.fields) };
    case "multipart":
      // Both text AND file parts round-trip: text parts store their value
      // verbatim; file parts encode their path (and optional content-type) as
      // a Bruno-style `@file(...)` value via `encodeMultipartValue`.
      return {
        kind: "multipartForm",
        fields: body.fields.map((f) => ({
          key: f.name,
          value: encodeMultipartValue(f),
          enabled: f.enabled,
        })),
      };
    case "binary":
      return { kind: "binary", path: body.path, contentType: body.contentType };
    case "graphql":
      return {
        kind: "graphQl",
        query: body.query,
        variables: body.variables,
      };
  }
}

function kvEnabledToKvRows(rows: KvEnabled[]): KvRow[] {
  return rows.map((r) => ({ enabled: r.enabled, key: r.key, value: r.value }));
}

/**
 * Reverse of {@link bodyToCollection}: turn a body loaded from a `.bru` file
 * back into the editor's {@link Body} shape so the Body tab hydrates with
 * the saved content (was previously hard-coded to `{ kind: "none" }` —
 * a bug that wiped saved bodies on tab reopen).
 */
export function bodyFromCollection(body: CollectionRequestBody | null): Body {
  if (!body) return { kind: "none" };
  switch (body.kind) {
    case "json":
      return { kind: "json", text: body.value };
    case "text":
      // Round-trip: if the stored content-type is JSON-ish, prefer the JSON
      // tab so the user gets syntax highlighting again. Otherwise show Raw.
      if (body.contentType.toLowerCase().includes("json")) {
        return { kind: "json", text: body.value };
      }
      return { kind: "raw", text: body.value, contentType: body.contentType };
    case "formUrlencoded":
      return { kind: "form", fields: kvEnabledToKvRows(body.fields) };
    case "multipartForm": {
      // Decode each row back into a text or file part. A value of
      // `@file(<path>)[@contentType(<mime>)]` becomes a file part; anything
      // else is a plain text part (see `decodeMultipartField`).
      const fields: MultipartField[] = body.fields.map(decodeMultipartField);
      return { kind: "multipart", fields };
    }
    case "graphQl":
      return { kind: "graphql", query: body.query, variables: body.variables };
    case "binary":
      return { kind: "binary", path: body.path, contentType: body.contentType };
  }
}

/** Convert an entire saved request into the editor's RequestForm + Auth. */
export function requestFromCollection(req: CollectionRequest): {
  headers: KvRow[];
  query: KvRow[];
  body: Body;
  auth: Auth;
  vars: KvRow[];
  preRequestScript: string;
  postResponseScript: string;
} {
  return {
    headers: kvEnabledToKvRows(req.headers),
    query: kvEnabledToKvRows(req.params),
    body: bodyFromCollection(req.body),
    auth: (req.auth ?? { kind: "none" }) as Auth,
    vars: kvEnabledToKvRows(req.vars),
    preRequestScript: req.preRequestScript ?? "",
    postResponseScript: req.postResponseScript ?? "",
  };
}

/** Convert an editor request + auth into a `.bru`-ready CollectionRequest. */
export function toCollectionRequest(
  name: string,
  url: string,
  method: string,
  headers: KvRow[],
  query: KvRow[],
  body: Body,
  auth: Auth,
  vars: KvRow[] = [],
  preRequestScript = "",
  postResponseScript = "",
): CollectionRequest {
  return {
    name,
    seq: null,
    method: method as CollectionRequest["method"],
    url,
    headers: kvRowsToKvEnabled(headers),
    params: kvRowsToKvEnabled(query),
    body: bodyToCollection(body),
    auth: auth.kind === "none" ? null : auth,
    vars: kvRowsToKvEnabled(vars),
    // Empty strings serialize to no `.bru` script block (Rust filters them out).
    preRequestScript: preRequestScript.trim() ? preRequestScript : null,
    postResponseScript: postResponseScript.trim() ? postResponseScript : null,
  };
}
