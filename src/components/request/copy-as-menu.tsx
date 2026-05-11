import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportAxios, exportCurl, exportFetch, exportGo, exportPython } from "@/lib/tauri";
import type { HttpRequest } from "@/lib/types";

type Exporter = (req: HttpRequest) => Promise<string>;

const FORMATS: { label: string; fn: Exporter }[] = [
  { label: "cURL", fn: exportCurl },
  { label: "fetch (JS)", fn: exportFetch },
  { label: "axios", fn: exportAxios },
  { label: "Python (requests)", fn: exportPython },
  { label: "Go", fn: exportGo },
];

async function copyAs(fn: Exporter, req: HttpRequest): Promise<void> {
  const text = await fn(req);
  await navigator.clipboard.writeText(text);
}

interface CopyAsMenuProps {
  request: HttpRequest;
}

export function CopyAsMenu({ request }: CopyAsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="shrink-0">
          Copy as
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {FORMATS.map(({ label, fn }) => (
          <DropdownMenuItem key={label} onClick={() => void copyAs(fn, request)}>
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
