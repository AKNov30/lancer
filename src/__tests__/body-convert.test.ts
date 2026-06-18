import { describe, expect, it } from "vitest";
import { bodyFromCollection, bodyToCollection } from "@/lib/collection-convert";
import { type Body, bodyToWire, type MultipartField } from "@/lib/types";

describe("bodyToWire — multipart", () => {
  it("maps text and file parts to the internally-tagged wire shape", () => {
    const body: Body = {
      kind: "multipart",
      fields: [
        { kind: "text", enabled: true, name: "caption", value: "hi" },
        {
          kind: "file",
          enabled: true,
          name: "avatar",
          path: "/tmp/a.png",
          contentType: "image/png",
        },
      ],
    };
    const wire = bodyToWire(body);
    expect(wire).toEqual({
      kind: "multipart",
      parts: [
        { kind: "text", name: "caption", value: "hi" },
        { kind: "file", name: "avatar", path: "/tmp/a.png", contentType: "image/png" },
      ],
    });
  });

  it("drops disabled and unnamed rows (matching form-field semantics)", () => {
    const body: Body = {
      kind: "multipart",
      fields: [
        { kind: "text", enabled: false, name: "skip", value: "x" },
        { kind: "text", enabled: true, name: "   ", value: "noname" },
        { kind: "text", enabled: true, name: "keep", value: "y" },
      ],
    };
    const wire = bodyToWire(body);
    expect(wire).toEqual({
      kind: "multipart",
      parts: [{ kind: "text", name: "keep", value: "y" }],
    });
  });

  it("never returns undefined for multipart anymore", () => {
    expect(bodyToWire({ kind: "multipart", fields: [] })).not.toBeUndefined();
  });
});

describe("collection-convert — multipart .bru round-trip", () => {
  it("round-trips text + file parts (file encoded as @file(...))", () => {
    const fields: MultipartField[] = [
      { kind: "text", enabled: true, name: "caption", value: "hello" },
      {
        kind: "file",
        enabled: true,
        name: "avatar",
        path: "/tmp/pic.png",
        contentType: "image/png",
      },
      { kind: "file", enabled: false, name: "skip", path: "/tmp/x.bin", contentType: "" },
    ];
    const original: Body = { kind: "multipart", fields };

    const collection = bodyToCollection(original);
    // File part should serialize Bruno-style with content-type suffix.
    expect(collection).toEqual({
      kind: "multipartForm",
      fields: [
        { key: "caption", value: "hello", enabled: true },
        { key: "avatar", value: "@file(/tmp/pic.png)@contentType(image/png)", enabled: true },
        { key: "skip", value: "@file(/tmp/x.bin)", enabled: false },
      ],
    });

    // Decoding back reproduces the editor body exactly.
    const back = bodyFromCollection(collection);
    expect(back).toEqual(original);
  });

  it("decodes a plain value as a text part", () => {
    const back = bodyFromCollection({
      kind: "multipartForm",
      fields: [{ key: "token", value: "abc123", enabled: true }],
    });
    expect(back).toEqual({
      kind: "multipart",
      fields: [{ kind: "text", enabled: true, name: "token", value: "abc123" }],
    });
  });
});
