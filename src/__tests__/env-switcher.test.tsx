import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  listEnvs: vi.fn().mockResolvedValue(["dev", "staging", "prod"]),
}));

import { EnvSwitcher } from "@/components/request/env-switcher";
import { useEnv } from "@/stores/env-store";
import { useWorkspace } from "@/stores/workspace-store";

// Radix ScrollArea uses ResizeObserver in jsdom — stub it.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
  RO as unknown as typeof ResizeObserver;

describe("EnvSwitcher", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useWorkspace.setState({
      rootPath: null,
      items: [],
      loading: false,
      error: null,
    });
    useEnv.setState({
      available: [],
      activeEnv: null,
      loading: false,
    });
  });

  it("shows 'No workspace' when rootPath is null", () => {
    render(<EnvSwitcher />);
    expect(screen.getByText(/no workspace/i)).toBeInTheDocument();
  });

  it("shows 'No environments' when workspace has none", async () => {
    const { listEnvs } = await import("@/lib/tauri");
    vi.mocked(listEnvs).mockResolvedValueOnce([]);
    useWorkspace.setState((s) => ({ ...s, rootPath: "/workspace" }));
    render(<EnvSwitcher />);
    await vi.waitFor(() => {
      expect(screen.getByText(/no environments/i)).toBeInTheDocument();
    });
  });

  it("lists envs when workspace is set and refresh resolves", async () => {
    useWorkspace.setState((s) => ({ ...s, rootPath: "/workspace" }));
    render(<EnvSwitcher />);
    await vi.waitFor(() => {
      expect(useEnv.getState().available).toEqual(["dev", "staging", "prod"]);
    });
  });

  it("persists activeEnv to localStorage on selection", () => {
    useWorkspace.setState((s) => ({ ...s, rootPath: "/workspace" }));
    useEnv.setState({ available: ["dev"], activeEnv: null, loading: false });
    // simulate the setter directly (radix Select interaction in jsdom is flaky)
    useEnv.getState().setActiveEnv("dev", "/workspace");
    expect(window.localStorage.getItem("lancer.activeEnv:/workspace")).toBe("dev");
    expect(useEnv.getState().activeEnv).toBe("dev");
  });
});
