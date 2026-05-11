import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { parseCurl } from "@/lib/tauri";
import type { Method } from "@/lib/types";
import { useRequest } from "@/stores/request-store";

function isMethod(s: string): s is Method {
  return ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(s);
}

export function CurlImportDialog() {
  const setUrl = useRequest((s) => s.setUrl);
  const setMethod = useRequest((s) => s.setMethod);

  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  function reset() {
    setText("");
    setError(null);
  }

  async function handleParse() {
    if (!text.trim()) return;
    setRunning(true);
    setError(null);
    try {
      const req = await parseCurl(text);
      setUrl(req.url);
      if (isMethod(req.method)) {
        setMethod(req.method as Method);
      }
      setOpen(false);
      reset();
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Import cURL
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Import from cURL</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground text-xs">
            Paste a <code className="font-mono">curl ...</code> command. Multi-line (backslash
            continuations) and quoted strings are supported.
          </p>
          <textarea
            className="h-40 w-full rounded-md border border-border bg-background p-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder={`curl -X POST https://api.example.com/users \\\n  -H 'content-type: application/json' \\\n  -d '{"name":"Alice"}'`}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            spellCheck={false}
          />
          {error && (
            <p className="rounded-md bg-destructive/10 px-2 py-1 text-destructive text-xs">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleParse()} disabled={running || !text.trim()}>
            {running ? "Parsing…" : "Parse & Load"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
