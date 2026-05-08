import { open } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import { listWorkspace, type WorkspaceItem } from "@/lib/tauri";

interface WorkspaceState {
  rootPath: string | null;
  items: WorkspaceItem[];
  loading: boolean;
  error: string | null;
  openFolder: () => Promise<void>;
  refresh: () => Promise<void>;
  setRootPath: (p: string | null) => void;
}

const STORAGE_KEY = "lancer.lastFolder";

function loadInitialRoot(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  rootPath: loadInitialRoot(),
  items: [],
  loading: false,
  error: null,
  setRootPath: (rootPath) => {
    if (rootPath) {
      window.localStorage.setItem(STORAGE_KEY, rootPath);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    set({ rootPath });
  },
  openFolder: async () => {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked !== "string") return;
      get().setRootPath(picked);
      await get().refresh();
    } catch (e) {
      set({ error: String(e) });
    }
  },
  refresh: async () => {
    const { rootPath } = get();
    if (!rootPath) {
      set({ items: [], loading: false, error: null });
      return;
    }
    set({ loading: true, error: null });
    try {
      const items = await listWorkspace(rootPath);
      set({ items, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
}));
