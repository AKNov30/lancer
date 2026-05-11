import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UrlBar } from "@/components/request/url-bar";
import { useRequest } from "@/stores/request-store";

vi.mock("@/lib/tauri", () => ({
  sendRequest: vi.fn(),
}));

import { sendRequest } from "@/lib/tauri";

describe("UrlBar", () => {
  beforeEach(() => {
    useRequest.setState({
      request: { url: "", method: "GET", headers: [], query: [] },
      response: null,
      loading: false,
      error: null,
    });
    vi.mocked(sendRequest).mockReset();
  });

  it("renders the method picker, url input, and Send button", () => {
    render(<UrlBar />);
    expect(screen.getByPlaceholderText(/https:/i)).toBeInTheDocument();
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

    await user.type(screen.getByPlaceholderText(/https:/i), "https://httpbin.org/get");
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

    await user.type(screen.getByPlaceholderText(/https:/i), "https://example.test");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await vi.waitFor(() => {
      expect(useRequest.getState().error).toMatch(/network down/);
      expect(useRequest.getState().response).toBeNull();
      expect(useRequest.getState().loading).toBe(false);
    });
  });
});
