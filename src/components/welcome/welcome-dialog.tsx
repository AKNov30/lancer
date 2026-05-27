import {
  ClockIcon,
  FileJsonIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  SparklesIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useUi } from "@/stores/ui-store";
import { useWelcome } from "@/stores/welcome-store";
import { useWorkspace } from "@/stores/workspace-store";
import { leafName, useWorkspaces } from "@/stores/workspaces-store";

/**
 * First-run welcome. Three action cards (Open / Import / Recent) sit above
 * a short pitch — the user has zero ambiguity about what to do next.
 *
 * The Recent column auto-hides when the registry is empty (true first run);
 * returning users see their existing workspaces front and centre instead of
 * having to navigate a file picker.
 */
export function WelcomeDialog() {
  const open = useWelcome((s) => s.open);
  const setOpen = useWelcome((s) => s.setOpen);
  const dismiss = useWelcome((s) => s.dismiss);
  const openFolder = useWorkspace((s) => s.openFolder);
  const setRootPath = useWorkspace((s) => s.setRootPath);
  const refresh = useWorkspace((s) => s.refresh);
  const requestAction = useUi((s) => s.requestAction);
  const recent = useWorkspaces((s) => s.recent);

  async function pickFolderAndDismiss() {
    dismiss();
    await openFolder();
  }

  function pickRecent(path: string) {
    dismiss();
    setRootPath(path);
    void refresh();
  }

  function startImport() {
    dismiss();
    requestAction({ type: "import-from-file" });
  }

  const hasRecent = recent.length > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className={cn(hasRecent ? "max-w-2xl" : "max-w-md")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-3xl italic">
            <SparklesIcon
              className="size-6 text-[color:var(--color-primary)]"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            Welcome to Lancer.
          </DialogTitle>
          <DialogDescription>
            A free, local-first API client. Collections live as plain files on your disk — no
            account, no cloud, your Git is the sync.
          </DialogDescription>
        </DialogHeader>

        <div className={cn("grid gap-3", hasRecent ? "sm:grid-cols-2" : "")}>
          {/* Primary actions column */}
          <div className="flex flex-col gap-2">
            <ActionCard
              icon={FolderPlusIcon}
              title="New workspace"
              hint="Just type a name — Lancer creates the folder under your Documents."
              accent="primary"
              onClick={() => {
                dismiss();
                requestAction({ type: "new-workspace" });
              }}
            />
            <ActionCard
              icon={FolderOpenIcon}
              title="Open existing folder"
              hint="Point at a Git repo or shared drive that already has .bru files."
              accent="muted"
              onClick={() => void pickFolderAndDismiss()}
            />
            <ActionCard
              icon={FileJsonIcon}
              title="Import from file"
              hint="Postman v2.1 / OpenAPI spec / Postman env — auto-detected."
              accent="muted"
              onClick={startImport}
            />
          </div>

          {/* Recent column — hidden on first run */}
          {hasRecent && (
            <div className="flex min-w-0 flex-col gap-2">
              <h4 className="px-1 font-mono font-semibold text-[10px] text-muted-foreground/70 tracking-[0.15em] uppercase">
                Recent
              </h4>
              <ul className="flex flex-col gap-1.5">
                {recent.slice(0, 6).map((w) => {
                  const name = w.name?.trim() || leafName(w.path);
                  return (
                    <li key={w.path}>
                      <button
                        type="button"
                        onClick={() => pickRecent(w.path)}
                        className={cn(
                          "group flex w-full cursor-pointer items-center gap-2 rounded-md border border-border/60 bg-card/40 px-2.5 py-2 text-left",
                          "transition-all hover:-translate-y-px hover:border-primary/40 hover:bg-card hover:shadow-sm",
                        )}
                      >
                        <ClockIcon
                          className="size-3.5 shrink-0 text-muted-foreground"
                          strokeWidth={1.75}
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-xs">{name}</div>
                          <div
                            className="truncate font-mono text-[10px] text-muted-foreground/70"
                            title={w.path}
                          >
                            {w.path}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={dismiss} className="cursor-pointer">
            Skip for now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionCard({
  icon: Icon,
  title,
  hint,
  accent,
  onClick,
}: {
  icon: typeof FolderOpenIcon;
  title: string;
  hint: string;
  accent: "primary" | "muted";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex cursor-pointer items-start gap-3 rounded-md border p-3 text-left",
        "transition-all duration-150 hover:-translate-y-px hover:shadow-md active:scale-[0.99]",
        accent === "primary"
          ? "border-primary/40 bg-primary/5 hover:border-primary/60 hover:bg-primary/10"
          : "border-border bg-card hover:border-primary/40",
      )}
    >
      <div
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-md transition-transform group-hover:scale-105",
          accent === "primary" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-sm">{title}</div>
        <div className="mt-0.5 text-muted-foreground text-xs leading-relaxed">{hint}</div>
      </div>
    </button>
  );
}
