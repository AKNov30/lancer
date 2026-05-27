import { TerminalIcon } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseCurl } from "@/lib/tauri";
import { isMethod, type Method, tuplesToKvRows, wireBodyToEditor } from "@/lib/types";
import { useRequest } from "@/stores/request-store";

interface CurlImportDialogProps {
  /** Controlled open state — when provided, no internal trigger is rendered */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CurlImportDialog({
  open: controlledOpen,
  onOpenChange,
}: CurlImportDialogProps = {}) {
  const setUrl = useRequest((s) => s.setUrl);
  const setMethod = useRequest((s) => s.setMethod);
  const setHeaders = useRequest((s) => s.setHeaders);
  const setQuery = useRequest((s) => s.setQuery);
  const setBody = useRequest((s) => s.setBody);

  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (v: boolean) => {
    if (isControlled) onOpenChange?.(v);
    else setInternalOpen(v);
  };
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
      // Previously this dropped headers, query, and body — only URL+method
      // survived. Now we round-trip the full parsed request into the editor
      // so users don't have to re-enter every detail.
      setHeaders(tuplesToKvRows(req.headers));
      setQuery(tuplesToKvRows(req.query));
      setBody(wireBodyToEditor(req.body));
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
      {!isControlled && (
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 cursor-pointer gap-1.5 px-2 text-xs">
            <TerminalIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            cURL
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Import from cURL</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Label htmlFor="curl-input" className="text-xs">
            Paste a <code className="font-mono">curl ...</code> command. Multi-line and quoted
            strings are supported.
          </Label>
          <Textarea
            id="curl-input"
            className="h-40 font-mono text-xs"
            placeholder={`curl -X POST https://api.example.com/users \\\n  -H 'content-type: application/json' \\\n  -d '{"name":"Alice"}'`}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            spellCheck={false}
          />
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
              <span className="font-medium text-destructive">Parse failed:</span>
              <span className="break-all font-mono text-muted-foreground">{error}</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} className="cursor-pointer">
            Cancel
          </Button>
          <Button
            onClick={() => void handleParse()}
            disabled={running || !text.trim()}
            className="cursor-pointer disabled:cursor-not-allowed"
          >
            {running ? "Parsing…" : "Parse & Load"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
