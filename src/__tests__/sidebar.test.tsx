import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// jsdom does not implement ResizeObserver; stub it so Radix ScrollArea doesn't crash.
if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

vi.mock("@/lib/tauri", () => ({
  listWorkspace: vi.fn().mockResolvedValue([]),
  readRequest: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

import { Sidebar } from "@/components/layout/sidebar";
import type { CollectionRequest, WorkspaceItem } from "@/lib/tauri";
import { listWorkspace, readRequest } from "@/lib/tauri";
import { useRequest } from "@/stores/request-store";
import { useWorkspace } from "@/stores/workspace-store";

describe("Sidebar", () => {
  beforeEach(() => {
    // Reset both stores
    useWorkspace.setState({
      rootPath: null,
      items: [],
      loading: false,
      error: null,
    });
    useRequest.setState({
      request: { url: "", method: "GET", headers: [], query: [] },
      auth: { kind: "none" },
      response: null,
      loading: false,
      error: null,
    });
    vi.mocked(readRequest).mockReset();
  });

  it("shows empty state with 'Open Folder' button when no rootPath", () => {
    render(<Sidebar />);
    expect(screen.getByText(/open a folder/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open folder/i })).toBeInTheDocument();
  });

  it("renders item list when rootPath set", () => {
    useWorkspace.setState({
      rootPath: "/test/workspace",
      items: [
        {
          path: "/test/workspace/login.bru",
          relPath: "login.bru",
          name: "Login",
          method: "POST",
          seq: 1,
        },
        {
          path: "/test/workspace/users.bru",
          relPath: "users.bru",
          name: "List Users",
          method: "GET",
          seq: 2,
        },
      ],
      loading: false,
      error: null,
    });
    render(<Sidebar />);
    expect(screen.getByText("Login")).toBeInTheDocument();
    expect(screen.getByText("List Users")).toBeInTheDocument();
  });

  it("loads request into store when item clicked", async () => {
    const loginItem: WorkspaceItem = {
      path: "/test/workspace/login.bru",
      relPath: "login.bru",
      name: "Login",
      method: "POST",
      seq: 1,
    };
    // Make listWorkspace return the item so refresh() doesn't wipe it
    vi.mocked(listWorkspace).mockResolvedValue([loginItem]);
    useWorkspace.setState({
      rootPath: "/test/workspace",
      items: [loginItem],
      loading: false,
      error: null,
    });
    vi.mocked(readRequest).mockResolvedValue({
      name: "Login",
      seq: 1,
      method: "POST",
      url: "https://api.example.com/auth/login",
      headers: [],
      params: [],
      body: null,
      auth: { kind: "bearer", token: "abc" },
      vars: [],
    } satisfies CollectionRequest);

    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(screen.getByText("Login"));

    await vi.waitFor(() => {
      const state = useRequest.getState();
      expect(state.request.url).toBe("https://api.example.com/auth/login");
      expect(state.request.method).toBe("POST");
      expect(state.auth.kind).toBe("bearer");
    });
  });
});
