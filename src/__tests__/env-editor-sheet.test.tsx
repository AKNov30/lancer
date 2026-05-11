import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  listEnvs: vi.fn().mockResolvedValue([]),
  readEnv: vi.fn(),
  writeEnv: vi.fn().mockResolvedValue(undefined),
  deleteEnv: vi.fn().mockResolvedValue(undefined),
  getSecret: vi.fn().mockResolvedValue(null),
  setSecret: vi.fn().mockResolvedValue(undefined),
  deleteSecret: vi.fn().mockResolvedValue(undefined),
}));

import { EnvEditorSheet } from "@/components/request/env-editor-sheet";
import { useWorkspace } from "@/stores/workspace-store";

// Radix ScrollArea uses ResizeObserver in jsdom — stub it.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
  RO as unknown as typeof ResizeObserver;

describe("EnvEditorSheet", () => {
  beforeEach(() => {
    useWorkspace.setState({ rootPath: null, items: [], loading: false, error: null });
  });

  it("shows 'Open a folder first.' when no workspace", () => {
    render(<EnvEditorSheet open={true} onOpenChange={() => {}} />);
    expect(screen.getByText(/open a folder first/i)).toBeInTheDocument();
  });

  it("loads env list when workspace set", async () => {
    const { listEnvs } = await import("@/lib/tauri");
    vi.mocked(listEnvs).mockResolvedValueOnce(["dev", "prod"]);
    useWorkspace.setState((s) => ({ ...s, rootPath: "/workspace" }));
    render(<EnvEditorSheet open={true} onOpenChange={() => {}} />);
    await vi.waitFor(() => {
      expect(screen.getByText("dev")).toBeInTheDocument();
      expect(screen.getByText("prod")).toBeInTheDocument();
    });
  });
});
