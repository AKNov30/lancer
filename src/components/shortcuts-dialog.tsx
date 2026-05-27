import { KeyboardIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useUi } from "@/stores/ui-store";

const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";

type Section = { heading: string; items: { keys: string[]; description: string }[] };

const SECTIONS: Section[] = [
  {
    heading: "Global",
    items: [
      { keys: [MOD, "K"], description: "Open command palette" },
      { keys: ["?"], description: "Show this cheatsheet" },
      { keys: ["Esc"], description: "Close dialog / palette" },
    ],
  },
  {
    heading: "Request",
    items: [
      {
        keys: [MOD, "Enter"],
        description: "HTTP: send · SSE/WS: connect or disconnect · gRPC: call",
      },
      { keys: [MOD, "S"], description: "Save request to .bru file" },
      { keys: [MOD, "L"], description: "Focus URL bar" },
    ],
  },
  {
    heading: "Editor (CodeMirror)",
    items: [
      { keys: [MOD, "D"], description: "Select next occurrence (multi-cursor)" },
      { keys: [isMac ? "⌥" : "Alt", "Click"], description: "Add cursor at click position" },
      { keys: [MOD, "/"], description: "Toggle line comment (JSON/raw editors)" },
      { keys: [MOD, "F"], description: "Find in editor" },
    ],
  },
  {
    heading: "Sidebar",
    items: [
      { keys: ["Right-click"], description: "Context menu (folder or request)" },
      { keys: ["Drag"], description: "Move .bru file to another folder" },
      { keys: ["Click", "row"], description: "Open request in current/new tab" },
    ],
  },
  {
    heading: "Tabs",
    items: [
      { keys: ["Drag"], description: "Reorder tabs horizontally" },
      { keys: ["Wheel"], description: "Scroll tab strip horizontally when overflowed" },
      { keys: ["×"], description: "Close tab (always one tab remains)" },
    ],
  },
];

/**
 * Keyboard shortcut cheatsheet. Bound to `?` (Shift+/) and discoverable via
 * the command palette. Section headers mirror the user's mental model:
 * Global → Request → Editor → Sidebar → Tabs.
 */
export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);
  const pendingAction = useUi((s) => s.pendingAction);
  const clearPendingAction = useUi((s) => s.clearPendingAction);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Bind `?` (which is Shift+/). Skip when user is typing in an input,
      // textarea, or contenteditable — otherwise typing a question mark
      // anywhere would steal the keystroke from the form.
      if (e.key !== "?") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      e.preventDefault();
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Allow the command palette to open us too.
  useEffect(() => {
    if (pendingAction?.type === "open-shortcuts") {
      setOpen(true);
      clearPendingAction();
    }
  }, [pendingAction, clearPendingAction]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyboardIcon className="size-4 text-primary" strokeWidth={1.75} aria-hidden="true" />
            Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>
            Press <Kbd>?</Kbd> anytime to reopen this dialog.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 py-1 sm:grid-cols-2">
          {SECTIONS.map((section) => (
            <section key={section.heading}>
              <h4 className="mb-1 font-mono font-semibold text-[10px] text-muted-foreground/70 tracking-[0.15em] uppercase">
                {section.heading}
              </h4>
              <ul className="space-y-1">
                {section.items.map((item) => (
                  <li
                    key={item.description}
                    className="flex items-center justify-between gap-2 rounded-sm py-0.5 text-xs"
                  >
                    <span className="text-muted-foreground">{item.description}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {item.keys.map((k) => (
                        <Kbd key={`${item.description}-${k}`}>{k}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[3px] border border-border bg-card px-1 font-mono font-medium text-[10px] text-foreground shadow-xs nums-tabular",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
