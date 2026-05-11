import { create } from "zustand";
import { listEnvs } from "@/lib/tauri";

interface EnvState {
  available: string[];
  activeEnv: string | null;
  loading: boolean;
  setActiveEnv: (name: string | null, workspaceRoot: string | null) => void;
  refresh: (workspaceRoot: string | null) => Promise<void>;
}

const STORAGE_KEY = (root: string) => `lancer.activeEnv:${root}`;

export const useEnv = create<EnvState>((set) => ({
  available: [],
  activeEnv: null,
  loading: false,
  setActiveEnv: (name, workspaceRoot) => {
    if (workspaceRoot) {
      if (name) window.localStorage.setItem(STORAGE_KEY(workspaceRoot), name);
      else window.localStorage.removeItem(STORAGE_KEY(workspaceRoot));
    }
    set({ activeEnv: name });
  },
  refresh: async (workspaceRoot) => {
    if (!workspaceRoot) {
      set({ available: [], activeEnv: null, loading: false });
      return;
    }
    set({ loading: true });
    try {
      const available = await listEnvs(workspaceRoot);
      const stored = window.localStorage.getItem(STORAGE_KEY(workspaceRoot));
      const activeEnv = stored && available.includes(stored) ? stored : null;
      set({ available, activeEnv, loading: false });
    } catch {
      set({ available: [], loading: false });
    }
  },
}));
