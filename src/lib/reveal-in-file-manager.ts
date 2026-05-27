import { invoke } from "@tauri-apps/api/core";

/**
 * Reveal a path in the host OS's file manager (Explorer on Windows, Finder
 * on macOS, `xdg-open` on Linux). Used by the sidebar's "Show in file
 * explorer" action so power-users can `git push` or zip workspace folders
 * without leaving Lancer to navigate.
 *
 * Backed by a small Rust command that calls the appropriate shell command
 * per platform. Errors are swallowed — there's nothing meaningful the UI
 * can do beyond logging.
 */
export async function revealInFileManager(path: string): Promise<void> {
  try {
    await invoke("reveal_in_file_manager", { path });
  } catch (e) {
    console.error("reveal_in_file_manager failed", e);
  }
}
