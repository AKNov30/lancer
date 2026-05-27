import { create } from "zustand";
import { historyClear, historyList, historyPin, historySearch } from "@/lib/tauri";

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
  pinned: boolean;
}

interface HistoryState {
  entries: HistoryEntry[];
  loading: boolean;
  query: string;
  /** Fetch all entries (no filter). */
  load: () => Promise<void>;
  /** Search entries by url/method substring. Empty query → load(). */
  search: (q: string) => Promise<void>;
  /** Toggle pinned flag on an entry; refreshes the list. */
  togglePin: (id: number, current: boolean) => Promise<void>;
  /** Wipe all entries (preserves nothing). */
  clear: () => Promise<void>;
}

export const useHistory = create<HistoryState>((set, get) => ({
  entries: [],
  loading: false,
  query: "",
  load: async () => {
    set({ loading: true, query: "" });
    try {
      const entries = await historyList(100);
      set({ entries, loading: false });
    } catch {
      set({ loading: false });
    }
  },
  search: async (q) => {
    set({ loading: true, query: q });
    try {
      const entries = q.trim() ? await historySearch(q, 100) : await historyList(100);
      set({ entries, loading: false });
    } catch {
      set({ loading: false });
    }
  },
  togglePin: async (id, current) => {
    await historyPin(id, !current);
    // Refresh to reflect new ordering (pinned-first).
    const q = get().query;
    if (q.trim()) await get().search(q);
    else await get().load();
  },
  clear: async () => {
    await historyClear();
    set({ entries: [], query: "" });
  },
}));
