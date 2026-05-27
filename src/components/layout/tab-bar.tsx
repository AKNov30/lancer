import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PlusIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { methodColor } from "@/lib/method-color";
import { cn } from "@/lib/utils";
import { type Tab, useTabs } from "@/stores/request-store";

const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export function TabBar() {
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const setActive = useTabs((s) => s.setActive);
  const closeTab = useTabs((s) => s.closeTab);
  const newTab = useTabs((s) => s.newTab);
  const reorderTabs = useTabs((s) => s.reorderTabs);

  // Closing a tab with unsaved edits must not silently discard them. A dirty
  // tab routes through a confirm dialog; clean tabs close immediately.
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);
  const requestClose = useCallback(
    (id: string) => {
      const tab = useTabs.getState().tabs.find((t) => t.id === id);
      if (tab?.dirty) setPendingCloseId(id);
      else closeTab(id);
    },
    [closeTab],
  );

  // dnd-kit sensors. PointerSensor requires a small distance threshold so a
  // plain click on a tab still activates it (rather than starting a drag).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Keep the active tab in view when it changes (Ctrl+Tab on an off-screen
  // tab should scroll it into view).
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const strip = scrollRef.current;
    if (!strip) return;
    const el = strip.querySelector<HTMLElement>(`[data-tab-id="${activeId}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  // Map vertical mouse wheel → horizontal scroll on the tab strip when it
  // overflows (mice with no horizontal scroll wheel).
  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    const strip = scrollRef.current;
    if (!strip) return;
    if (strip.scrollWidth <= strip.clientWidth) return;
    if (e.deltaY !== 0 && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      strip.scrollLeft += e.deltaY;
    }
  }

  // Keyboard shortcuts: Ctrl/Cmd+T new, Ctrl/Cmd+W close, Ctrl+Tab next, Ctrl+Shift+Tab prev
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = isMac ? e.metaKey : e.ctrlKey;
      if (meta && e.key.toLowerCase() === "t") {
        e.preventDefault();
        newTab();
      } else if (meta && e.key.toLowerCase() === "w") {
        e.preventDefault();
        requestClose(activeId);
      } else if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        const idx = tabs.findIndex((t) => t.id === activeId);
        const next = e.shiftKey
          ? tabs[(idx - 1 + tabs.length) % tabs.length]
          : tabs[(idx + 1) % tabs.length];
        if (next) setActive(next.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tabs, activeId, newTab, requestClose, setActive]);

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIdx = tabs.findIndex((t) => t.id === active.id);
    const toIdx = tabs.findIndex((t) => t.id === over.id);
    if (fromIdx === -1 || toIdx === -1) return;
    reorderTabs(fromIdx, toIdx);
  }

  const pendingTab = pendingCloseId ? tabs.find((t) => t.id === pendingCloseId) : null;

  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-0 border-border/60 border-b bg-card/40 backdrop-blur">
        <div
          ref={scrollRef}
          onWheel={onWheel}
          className="tab-strip min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
            // Restrict drag to horizontal axis only — a tab bar is a single
            // horizontal strip; allowing vertical movement just feels wrong.
            // Also restrict to the parent strip so a tab can't be dragged
            // outside the visible scroll area.
            modifiers={[restrictToHorizontalAxis, restrictToParentElement]}
          >
            <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
              <div className="flex h-9 min-w-max items-center">
                {tabs.map((tab) => (
                  <SortableTab
                    key={tab.id}
                    tab={tab}
                    isActive={tab.id === activeId}
                    onActivate={() => setActive(tab.id)}
                    onClose={() => requestClose(tab.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        {/* New-tab button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => newTab()}
          className="h-9 w-9 shrink-0 cursor-pointer rounded-none p-0 text-muted-foreground hover:text-foreground"
          title={`New tab (${isMac ? "⌘T" : "Ctrl+T"})`}
          aria-label="New tab"
        >
          <PlusIcon className="size-4" strokeWidth={1.75} aria-hidden="true" />
        </Button>
      </div>

      <AlertDialog
        open={pendingCloseId !== null}
        onOpenChange={(o) => {
          if (!o) setPendingCloseId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              "{pendingTab?.name ?? "This request"}" has unsaved edits. Closing it discards them —
              this can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingCloseId(null)}>
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (pendingCloseId) closeTab(pendingCloseId);
                setPendingCloseId(null);
              }}
            >
              Discard &amp; close
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface SortableTabProps {
  tab: Tab;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
}

function SortableTab({ tab, isActive, onActivate, onClose }: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
  });

  const methodC = methodColor(tab.request.method);
  const label = tab.savedPath ? tab.name : tab.request.url || tab.name;

  // Compose transform so the tab visibly slides during drag.
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    backgroundColor: isDragging ? undefined : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-tab-id={tab.id}
      data-active={isActive}
      // dnd-kit's listeners + attributes go on the draggable region.
      // Spread them on the OUTER div so dragging the body of the tab
      // triggers reorder, but inner controls (close ×) still receive clicks.
      {...attributes}
      {...listeners}
      className={cn(
        "group/tab relative flex h-9 max-w-[200px] cursor-grab items-center gap-2 border-border/40 border-r pl-3 pr-1.5 text-xs",
        "transition-colors duration-150",
        "hover:bg-accent/30 active:cursor-grabbing",
        "data-[active=true]:bg-background data-[active=true]:shadow-[inset_0_2px_0_0_var(--color-primary)]",
        isDragging && "z-10 opacity-50",
      )}
      // Click activates the tab (PointerSensor activation distance prevents
      // this from firing when the user starts a drag).
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
      role="tab"
      aria-selected={isActive}
      tabIndex={0}
      title={tab.savedPath ?? "Unsaved scratch tab"}
    >
      {/* Method dot */}
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full"
        style={{
          backgroundColor: methodC,
          boxShadow: isActive ? `0 0 6px ${methodC}` : undefined,
        }}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-mono",
          isActive ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      {/* Dirty dot — only on saved tabs that have unsaved edits */}
      {tab.dirty && tab.savedPath && (
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full bg-[color:var(--color-warning)]"
          title="Unsaved changes"
        />
      )}
      {/* Close × — opt out of the drag listener so clicking it closes the
          tab instead of trying to drag the whole tab. */}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className={cn(
          "grid size-5 cursor-pointer place-items-center rounded-sm text-muted-foreground/40 transition-all",
          "hover:bg-accent hover:text-foreground",
          "opacity-0 group-hover/tab:opacity-100",
          isActive && "opacity-60",
        )}
        aria-label={`Close ${tab.name}`}
        title="Close tab (Ctrl+W)"
      >
        <XIcon className="size-3" strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}
