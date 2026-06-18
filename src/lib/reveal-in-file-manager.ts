import { invoke } from "@tauri-apps/api/core";
import { toast } from "@/stores/toast-store";

/**
 * Reveal a path in the host OS's file manager (Explorer on Windows, Finder
 * on macOS, `xdg-open` on Linux). Used by the sidebar's "Show in file
 * explorer" action so power-users can `git push` or zip workspace folders
 * without leaving Lancer to navigate.
 *
 * Backed by a small Rust command that calls the appropriate shell command
 * per platform. On failure we log and surface a toast — this is a direct
 * user action with no other visible outcome, so silent failure looks broken.
 */
export async function revealInFileManager(path: string): Promise<void> {
  try {
    await invoke("reveal_in_file_manager", { path });
  } catch (e) {
    console.error("reveal_in_file_manager failed", e);
    toast.error("Couldn't open in file explorer", {
      description: e instanceof Error ? e.message : String(e),
    });
  }
}
