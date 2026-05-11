import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export interface MockStatus {
  running: boolean;
  port: number | null;
  specPath: string | null;
  error: string | null;
}

interface MockState extends MockStatus {
  start: (specPath: string, port: number) => Promise<void>;
  stop: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const useMock = create<MockState>((set) => ({
  running: false,
  port: null,
  specPath: null,
  error: null,
  start: async (specPath, port) => {
    const s = await invoke<MockStatus>("mock_start", { specPath, port });
    set(s);
  },
  stop: async () => {
    const s = await invoke<MockStatus>("mock_stop");
    set(s);
  },
  refresh: async () => {
    const s = await invoke<MockStatus>("mock_status");
    set(s);
  },
}));
