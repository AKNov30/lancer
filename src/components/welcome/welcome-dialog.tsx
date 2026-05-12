import { FolderOpenIcon, ImportIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWelcome } from "@/stores/welcome-store";
import { useWorkspace } from "@/stores/workspace-store";

export function WelcomeDialog() {
  const open = useWelcome((s) => s.open);
  const setOpen = useWelcome((s) => s.setOpen);
  const dismiss = useWelcome((s) => s.dismiss);
  const openFolder = useWorkspace((s) => s.openFolder);

  async function openFolderAndDismiss() {
    dismiss();
    await openFolder();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
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
            A free, local-first API client. Your collections live as plain files on your disk — no
            account, no cloud, your Git is the sync.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="font-semibold">Three ways to start:</p>
          <ul className="space-y-2.5 text-muted-foreground">
            <li className="flex items-start gap-2">
              <FolderOpenIcon
                className="mt-0.5 size-4 shrink-0 text-muted-foreground/70"
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <span>
                <strong className="text-foreground">Open a folder</strong> — pick an empty folder;
                Lancer will save your requests there.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <ImportIcon
                className="mt-0.5 size-4 shrink-0 text-muted-foreground/70"
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <span>
                <strong className="text-foreground">Import OpenAPI</strong> — drop an{" "}
                <code className="font-mono">openapi.yaml</code> and get a starter collection.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <ImportIcon
                className="mt-0.5 size-4 shrink-0 text-muted-foreground/70"
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <span>
                <strong className="text-foreground">Import Postman</strong> — v2.1 collection JSON →
                a folder of <code className="font-mono">.bru</code> files.
              </span>
            </li>
          </ul>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={dismiss}>
            Skip
          </Button>
          <Button onClick={() => void openFolderAndDismiss()}>Open folder</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
