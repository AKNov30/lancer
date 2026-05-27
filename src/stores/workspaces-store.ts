import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * One known workspace — a folder on disk the user has opened at some point.
 * `name` is an OPTIONAL friendly label ("Client API" instead of
 * `D:\projects\acme-client-api`); when blank the UI falls back to the
 * folder's leaf name.
 */
export interface RecentWorkspace {
  path: string;
  /** Friendly label; empty/undefined → derive from leaf folder name */
  name?: string;
  /** Wall-clock millis of the last `add()` so the dropdown can sort MRU. */
  lastOpenedAt: number;
}

interface WorkspacesState {
  recent: RecentWorkspace[];
  /** Record this path as the most-recently-opened workspace. Idempotent on
   *  path; the timestamp moves forward each call so the dropdown re-sorts. */
  add: (path: string, name?: string) => void;
  /** Drop one path from the recents list (e.g. user trashed the folder). */
  remove: (path: string) => void;
  /** Set/replace the friendly name on an existing recent entry. */
  rename: (path: string, name: string) => void;
  /** Wipe everything — useful for the Settings sheet's "Clear recents". */
  clear: () => void;
}

const MAX_RECENT = 12;
const STORAGE_KEY = "lancer.workspaces.v1";

/**
 * Derive a default display name from the path's last segment. Strips
 * trailing slashes first so `/home/me/api/` and `/home/me/api` both
 * surface as `api`.
 */
export function leafName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed;
}

export const useWorkspaces = create<WorkspacesState>()(
  persist(
    (set) => ({
      recent: [],

      add: (path, name) =>
        set((s) => {
          if (!path) return s;
          // Replace by path (case-insensitive on Windows-style absolute paths
          // — `D:\` vs `d:\` should be the same workspace).
          const other = s.recent.filter((w) => w.path.toLowerCase() !== path.toLowerCase());
          const existing = s.recent.find((w) => w.path.toLowerCase() === path.toLowerCase());
          const next: RecentWorkspace = {
            path,
            name: name ?? existing?.name,
            lastOpenedAt: Date.now(),
          };
          return { recent: [next, ...other].slice(0, MAX_RECENT) };
        }),

      remove: (path) =>
        set((s) => ({
          recent: s.recent.filter((w) => w.path.toLowerCase() !== path.toLowerCase()),
        })),

      rename: (path, name) =>
        set((s) => ({
          recent: s.recent.map((w) =>
            w.path.toLowerCase() === path.toLowerCase()
              ? { ...w, name: name.trim() || undefined }
              : w,
          ),
        })),

      clear: () => set({ recent: [] }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => window.localStorage),
      version: 1,
    },
  ),
);
