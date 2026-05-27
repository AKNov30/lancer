import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ConnectionMode } from "@/lib/types";

const MODES: { value: ConnectionMode; label: string }[] = [
  { value: "http", label: "HTTP" },
  { value: "sse", label: "SSE" },
  { value: "websocket", label: "WS" },
  { value: "grpc", label: "gRPC" },
];

interface Props {
  value: ConnectionMode;
  onChange: (m: ConnectionMode) => void;
  /** Disabled while a connection is live so the transport can't change mid-stream. */
  disabled?: boolean;
}

/** Connection-mode picker (HTTP / SSE / WebSocket). Sits beside the method select. */
export function ModeSelect({ value, onChange, disabled }: Props) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as ConnectionMode)} disabled={disabled}>
      <SelectTrigger
        className="group w-[88px] cursor-pointer gap-2 font-mono font-semibold text-xs tracking-wide transition-all duration-150 hover:shadow-sm focus:shadow-[var(--shadow-glow)] disabled:cursor-not-allowed"
        aria-label={`Connection mode, currently ${value}`}
        title="Connection type"
      >
        {/*
          A muted accent dot mirrors the MethodSelect trigger so the two adjacent
          pickers read as the same component family. Neutral (not colored) so it
          doesn't compete with the method dot beside it.
        */}
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40 transition-colors duration-150 group-hover:bg-muted-foreground/70"
        />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MODES.map((m) => (
          <SelectItem
            key={m.value}
            value={m.value}
            className="cursor-pointer font-mono font-semibold text-xs tracking-wide"
          >
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
