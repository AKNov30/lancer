import { open } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import { listWorkspace, startWatching, stopWatching, type WorkspaceItem } from "@/lib/tauri";
import { useWorkspaces } from "@/stores/workspaces-store";

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
      // Record into the recents registry so the WorkspaceSwitcher
      // dropdown surfaces this path on the next open.
      useWorkspaces.getState().add(rootPath);
      // Best-effort: start the FS watcher so external edits auto-refresh
      // the sidebar. Failure (e.g. on platforms without notify support) is
      // non-fatal — user can still hit the refresh button.
      void startWatching(rootPath).catch(() => {});
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
      void stopWatching().catch(() => {});
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
