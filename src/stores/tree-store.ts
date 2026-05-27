import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Sidebar folder expand/collapse state, keyed by the folder's relative path
 * (e.g. `"users"` or `"users/admin"`). Lives in its own persisted store so:
 *
 *  1. Manual toggles SURVIVE a `refresh()` — previously each row held its own
 *     `useState(true)`, so the file watcher's refresh re-mounted the tree and
 *     re-expanded everything, fighting the user.
 *  2. Expand state persists across app restarts (matches VS Code / Postman).
 *
 * Default for a path NOT yet in the map: top-level folders (depth 0) start
 * expanded so collections are visible; deeper folders start collapsed to keep
 * a big workspace scannable.
 */
interface TreeState {
  /** path → explicit user choice. Absent = use bulk mode / depth default. */
  expanded: Record<string, boolean>;
  /**
   * Workspace-wide override applied by the Collapse-all / Expand-all buttons.
   * `null` = use per-depth default. A subsequent per-folder toggle records an
   * explicit `expanded[path]` that wins over the bulk mode.
   */
  bulkMode: "open" | "closed" | null;
  set: (path: string, open: boolean) => void;
  collapseAll: () => void;
  expandAll: () => void;
  /** Resolve the effective open state for a folder at `depth`. */
  isOpen: (path: string, depth: number) => boolean;
}

const STORAGE_KEY = "lancer.tree.v1";

export const useTree = create<TreeState>()(
  persist(
    (set, get) => ({
      expanded: {},
      bulkMode: null,
      set: (path, open) => set((s) => ({ expanded: { ...s.expanded, [path]: open } })),
      // Collapse/Expand all = clear every per-folder override and set the
      // workspace-wide mode, so the whole tree snaps to one state.
      collapseAll: () => set({ expanded: {}, bulkMode: "closed" }),
      expandAll: () => set({ expanded: {}, bulkMode: "open" }),
      isOpen: (path, depth) => {
        const explicit = get().expanded[path];
        if (explicit !== undefined) return explicit;
        const mode = get().bulkMode;
        if (mode === "open") return true;
        if (mode === "closed") return false;
        return depth === 0; // default: top-level expanded, deeper collapsed
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => window.localStorage),
      version: 1,
    },
  ),
);
