import { getCurrentWindow } from "@tauri-apps/api/window";
import { CopyIcon, MinusIcon, SquareIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Windows-11-style title bar window controls (minimize / maximize / close).
 *
 * Replaces the native Tauri decorations (which on Windows don't reliably
 * follow `setTheme()` due to a DWM repaint quirk) with HTML buttons we
 * fully control. Sizing follows the WinUI convention — 46×32 dp.
 *
 * Buttons opt out of `data-tauri-drag-region` so clicks don't get swallowed
 * by the drag handler in the surrounding header.
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | null = null;

    void win.isMaximized().then(setMaximized);

    // Tauri 2 fires `tauri://resize` on every size change; we use it to
    // toggle between the "maximize" and "restore" icons in real time.
    void win
      .onResized(() => {
        void win.isMaximized().then(setMaximized);
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
    };
  }, []);

  const minimize = () => void getCurrentWindow().minimize();
  const toggleMaximize = () => void getCurrentWindow().toggleMaximize();
  const close = () => void getCurrentWindow().close();

  return (
    <div className="flex shrink-0 items-center" data-tauri-drag-region={false}>
      <ControlButton onClick={minimize} aria-label="Minimize">
        <MinusIcon className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
      </ControlButton>
      <ControlButton onClick={toggleMaximize} aria-label={maximized ? "Restore" : "Maximize"}>
        {maximized ? (
          <CopyIcon className="size-3" strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <SquareIcon className="size-3" strokeWidth={1.5} aria-hidden="true" />
        )}
      </ControlButton>
      <ControlButton onClick={close} aria-label="Close" danger>
        <XIcon className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
      </ControlButton>
    </div>
  );
}

function ControlButton({
  onClick,
  children,
  danger,
  ...rest
}: {
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
} & React.AriaAttributes) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tauri-drag-region={false}
      className={cn(
        "grid h-10 w-[46px] cursor-pointer place-items-center text-foreground/70 transition-colors duration-100",
        danger
          ? "hover:bg-red-500 hover:text-white"
          : "hover:bg-foreground/10 hover:text-foreground",
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
