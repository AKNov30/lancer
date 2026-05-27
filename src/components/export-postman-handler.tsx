import { save } from "@tauri-apps/plugin-dialog";
import { useEffect } from "react";
import { workspaceToPostmanJson } from "@/lib/postman-export";
import { saveBytes, type WorkspaceItem } from "@/lib/tauri";
import { useUi } from "@/stores/ui-store";
import { useWorkspace } from "@/stores/workspace-store";

/**
 * Headless component mounted in AppShell. Listens for `export-postman` and
 * `export-postman-folder` pending actions, prompts for a save path, then
 * writes the chosen scope as Postman v2.1 JSON.
 *
 * - `export-postman` → whole workspace
 * - `export-postman-folder` → only the items inside `folderPath` (recursive)
 *
 * Lives outside Sidebar so it can run even when no row is selected.
 */
export function ExportPostmanHandler() {
  const pendingAction = useUi((s) => s.pendingAction);
  const clearPendingAction = useUi((s) => s.clearPendingAction);
  const rootPath = useWorkspace((s) => s.rootPath);
  const items = useWorkspace((s) => s.items);

  useEffect(() => {
    if (
      pendingAction?.type !== "export-postman" &&
      pendingAction?.type !== "export-postman-folder"
    ) {
      return;
    }

    const action = pendingAction;
    void (async () => {
      clearPendingAction();
      if (!rootPath) return;

      const isFolder = action.type === "export-postman-folder";
      const sep = rootPath.includes("\\") ? "\\" : "/";

      let scopeName: string;
      let scopeItems: WorkspaceItem[];
      let scopeRelPathOffset = "";

      if (isFolder) {
        const folderPath = action.folderPath;
        // Trim trailing separator before deriving the leaf name so
        // `D:\workspace\users\` and `D:\workspace\users` both pick "users".
        const trimmed = folderPath.replace(/[\\/]+$/, "");
        scopeName = trimmed.split(sep).pop() ?? "collection";
        // Reduce relPath so the exported tree is rooted at this folder
        // (otherwise Postman shows the workspace path as outer folders).
        const root = rootPath.replace(/[\\/]+$/, "");
        scopeRelPathOffset = trimmed.startsWith(root)
          ? trimmed.slice(root.length).replace(/^[\\/]+/, "")
          : "";
        scopeItems = items
          .filter((it) => it.kind === "file")
          .filter((it) => it.path === folderPath || it.path.startsWith(trimmed + sep))
          .map((it) => {
            if (!scopeRelPathOffset) return it;
            // Strip the offset prefix from relPath so the export tree is
            // rooted at the chosen folder.
            const norm = it.relPath.replace(/\\/g, "/");
            const off = scopeRelPathOffset.replace(/\\/g, "/");
            const stripped = norm.startsWith(`${off}/`) ? norm.slice(off.length + 1) : norm;
            return { ...it, relPath: stripped };
          });
      } else {
        scopeName = rootPath.split(sep).pop() ?? "workspace";
        scopeItems = items;
      }

      const suggested = `${scopeName}.postman_collection.json`;

      try {
        const target = await save({
          defaultPath: suggested,
          filters: [{ name: "Postman Collection", extensions: ["json"] }],
          title: isFolder
            ? `Export "${scopeName}" as Postman v2.1`
            : "Export workspace as Postman v2.1",
        });
        if (!target) return;

        const json = await workspaceToPostmanJson(scopeName, scopeItems);
        // saveBytes takes number[] (Uint8Array equivalent) — encode UTF-8.
        const bytes = Array.from(new TextEncoder().encode(json));
        await saveBytes(target, bytes);
      } catch (e) {
        console.error("Postman export failed", e);
      }
    })();
  }, [pendingAction, clearPendingAction, rootPath, items]);

  return null;
}
