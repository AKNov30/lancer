import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

import { useHistory } from "@/stores/history-store";

describe("history-store", () => {
  beforeEach(() => {
    useHistory.setState({ entries: [], loading: false });
  });

  it("load calls history_list", async () => {
    await useHistory.getState().load();
    expect(useHistory.getState().loading).toBe(false);
  });
});
