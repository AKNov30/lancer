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
          <DialogTitle className="font-display text-3xl italic">Welcome to Lancer.</DialogTitle>
          <DialogDescription>
            A free, local-first API client. Your collections live as plain files on your disk — no
            account, no cloud, your Git is the sync.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="font-semibold">Three ways to start:</p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Open a folder</strong> — pick an empty folder;
              Lancer will save your requests there.
            </li>
            <li>
              <strong className="text-foreground">Import OpenAPI</strong> — drop an{" "}
              <code className="font-mono">openapi.yaml</code> and get a starter collection.
            </li>
            <li>
              <strong className="text-foreground">Import Postman</strong> — v2.1 collection JSON → a
              folder of <code className="font-mono">.bru</code> files.
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
