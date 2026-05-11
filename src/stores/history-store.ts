import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export interface HistoryEntry {
  id: number;
  timestamp: number;
  url: string;
  method: string;
  status: number;
  elapsedMs: number;
  sizeBytes: number;
  headersJson: string;
  bodyTextPreview: string | null;
}

interface HistoryState {
  entries: HistoryEntry[];
  loading: boolean;
  load: () => Promise<void>;
  clear: () => Promise<void>;
}

export const useHistory = create<HistoryState>((set) => ({
  entries: [],
  loading: false,
  load: async () => {
    set({ loading: true });
    try {
      const entries = await invoke<HistoryEntry[]>("history_list", { limit: 100 });
      set({ entries, loading: false });
    } catch {
      set({ loading: false });
    }
  },
  clear: async () => {
    await invoke<void>("history_clear");
    set({ entries: [] });
  },
}));
