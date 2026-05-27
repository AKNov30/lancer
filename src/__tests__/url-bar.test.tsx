import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UrlBar } from "@/components/request/url-bar";
import { useRequest } from "@/stores/request-store";

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri")>();
  return {
    ...actual,
    sendRequest: vi.fn(),
    exportCurl: vi.fn().mockResolvedValue("curl -X GET 'https://example.com'"),
    exportFetch: vi.fn().mockResolvedValue("await fetch('https://example.com', {});"),
    exportAxios: vi.fn().mockResolvedValue("await axios({});"),
    exportPython: vi
      .fn()
      .mockResolvedValue("import requests\n\nresp = requests.get('https://example.com')"),
    exportGo: vi.fn().mockResolvedValue("package main\n\nfunc main() {}"),
  };
});

import { sendRequest } from "@/lib/tauri";

describe("UrlBar", () => {
  beforeEach(() => {
    useRequest.setState({
      request: {
        url: "",
        method: "GET",
        headers: [],
        query: [],
        body: { kind: "none" },
        options: {},
        vars: [],
        captures: [],
      },
      response: null,
      loading: false,
      error: null,
    });
    vi.mocked(sendRequest).mockReset();
  });

  it("renders the method picker, url input, and Send button", () => {
    render(<UrlBar />);
    // The URL field is now a CodeMirror single-line editor whose content is
    // an accessible textbox labelled "Request URL".
    expect(screen.getByRole("textbox", { name: /request url/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
  });

  it("disables Send when the url is empty", () => {
    render(<UrlBar />);
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("sends a request and stores the response on success", async () => {
    vi.mocked(sendRequest).mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: [["content-type", "application/json"]],
      body: [],
      bodyText: '{"ok":true}',
      elapsedMs: 12,
      sizeBytes: 11,
    });

    const user = userEvent.setup();
    render(<UrlBar />);

    // CodeMirror's contentEditable can't be typed into reliably under jsdom,
    // so set the URL the same way the editor's onChange would (drives setUrl),
    // then exercise the real Send path.
    expect(screen.getByRole("textbox", { name: /request url/i })).toBeInTheDocument();
    useRequest.getState().setUrl("https://httpbin.org/get");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await vi.waitFor(() => {
      expect(useRequest.getState().response?.status).toBe(200);
      expect(useRequest.getState().error).toBeNull();
      expect(useRequest.getState().loading).toBe(false);
    });

    expect(vi.mocked(sendRequest)).toHaveBeenCalledOnce();
    expect(vi.mocked(sendRequest)).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://httpbin.org/get", method: "GET" }),
      expect.objectContaining({ kind: "none" }),
      expect.objectContaining({ workspaceRoot: undefined, envName: null }),
    );
  });

  it("captures errors when sendRequest rejects", async () => {
    vi.mocked(sendRequest).mockRejectedValue(new Error("network down"));

    const user = userEvent.setup();
    render(<UrlBar />);

    useRequest.getState().setUrl("https://example.test");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await vi.waitFor(() => {
      expect(useRequest.getState().error).toMatch(/network down/);
      expect(useRequest.getState().response).toBeNull();
      expect(useRequest.getState().loading).toBe(false);
    });
  });
});
