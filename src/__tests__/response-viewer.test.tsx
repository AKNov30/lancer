import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ResponseViewer } from "@/components/response/response-viewer";
import { useRequest } from "@/stores/request-store";

describe("ResponseViewer", () => {
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
      auth: { kind: "none" },
      response: null,
      loading: false,
      error: null,
    });
  });

  it("shows 'Sending…' while loading", () => {
    useRequest.setState((s) => ({ ...s, loading: true }));
    render(<ResponseViewer />);
    expect(screen.getByText(/sending/i)).toBeInTheDocument();
  });

  it("shows error message when error is set", () => {
    useRequest.setState((s) => ({ ...s, error: "connection refused" }));
    render(<ResponseViewer />);
    expect(screen.getByText(/request failed/i)).toBeInTheDocument();
    expect(screen.getByText(/connection refused/i)).toBeInTheDocument();
  });

  it("shows empty state when no response and not loading", () => {
    render(<ResponseViewer />);
    expect(screen.getByText(/no response yet/i)).toBeInTheDocument();
  });

  it("renders status line and pretty-prints JSON body", () => {
    useRequest.setState((s) => ({
      ...s,
      response: {
        status: 200,
        statusText: "OK",
        headers: [["content-type", "application/json"]],
        body: [],
        bodyText: '{"ok":true,"n":42}',
        elapsedMs: 12,
        sizeBytes: 18,
      },
    }));
    render(<ResponseViewer />);
    // Status line
    expect(screen.getByText(/200 OK/)).toBeInTheDocument();
    expect(screen.getByText(/12 ms/)).toBeInTheDocument();
    expect(screen.getByText(/18 B/)).toBeInTheDocument();
    // Pretty body — shadcn Tabs renders all panels into the DOM but visually hides inactive
    // The default tab is "body", so its content should be present.
    // JSON.stringify with 2-space indent should produce ' "ok": true' etc.
    const body = screen.getByText(/"ok":/);
    expect(body.textContent).toContain('"ok": true');
    expect(body.textContent).toContain('"n": 42');
  });
});
