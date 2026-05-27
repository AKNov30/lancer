import { CodeIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportAxios, exportCurl, exportFetch, exportGo, exportPython } from "@/lib/tauri";
import type { HttpRequest } from "@/lib/types";
import { type RequestForm, toWireRequest } from "@/stores/request-store";

type Exporter = (req: HttpRequest) => Promise<string>;

const FORMATS: { label: string; fn: Exporter }[] = [
  { label: "cURL", fn: exportCurl },
  { label: "fetch (JavaScript)", fn: exportFetch },
  { label: "axios", fn: exportAxios },
  { label: "Python (requests)", fn: exportPython },
  { label: "Go (net/http)", fn: exportGo },
];

async function copyAs(fn: Exporter, req: HttpRequest): Promise<void> {
  const text = await fn(req);
  await navigator.clipboard.writeText(text);
}

interface CopyAsMenuProps {
  request: RequestForm;
}

/**
 * Compact icon-only "Copy as code" dropdown.
 *
 * Sized to match the URL bar's secondary controls (h-9 w-9) rather than the
 * primary Send button. Discoverability via tooltip + dropdown caret on hover.
 */
export function CopyAsMenu({ request }: CopyAsMenuProps) {
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [failedLabel, setFailedLabel] = useState<string | null>(null);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 shrink-0 cursor-pointer p-0 text-muted-foreground transition-colors hover:text-foreground"
          title="Copy as code (cURL, fetch, axios, Python, Go)"
          aria-label="Copy this request as code"
        >
          <CodeIcon className="size-4" strokeWidth={1.75} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[200px]">
        <DropdownMenuLabel className="font-mono font-semibold text-[10px] text-muted-foreground/70 tracking-[0.15em] uppercase">
          Copy as
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {FORMATS.map(({ label, fn }) => (
          <DropdownMenuItem
            key={label}
            className="cursor-pointer"
            onSelect={async (e) => {
              e.preventDefault();
              const wire = toWireRequest(request);
              if (!wire) return; // multipart not yet supported on wire
              try {
                await copyAs(fn, wire);
                setFailedLabel(null);
                setCopiedLabel(label);
                setTimeout(() => setCopiedLabel(null), 1500);
              } catch {
                // Surface clipboard/export failures instead of silently no-oping.
                setCopiedLabel(null);
                setFailedLabel(label);
                setTimeout(() => setFailedLabel(null), 1500);
              }
            }}
          >
            <span className="flex-1 font-mono text-xs">{label}</span>
            {copiedLabel === label && (
              <span className="text-[color:var(--color-success)] text-[11px]">Copied</span>
            )}
            {failedLabel === label && (
              <span className="text-destructive text-[11px]">Copy failed</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
