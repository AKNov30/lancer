import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Method } from "@/lib/types";

const METHODS: Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const COLOR: Record<Method, string> = {
  GET: "var(--color-method-get)",
  POST: "var(--color-method-post)",
  PUT: "var(--color-method-put)",
  PATCH: "var(--color-method-patch)",
  DELETE: "var(--color-method-delete)",
  HEAD: "var(--color-method-head)",
  OPTIONS: "var(--color-method-options)",
};

interface Props {
  value: Method;
  onChange: (m: Method) => void;
}

export function MethodSelect({ value, onChange }: Props) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Method)}>
      <SelectTrigger
        className="w-[120px] gap-2 font-mono font-semibold tracking-wider"
        style={{ color: COLOR[value] }}
        aria-label={`HTTP method, currently ${value}`}
      >
        {/* Color dot before the value for fast scanning */}
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: COLOR[value] }}
        />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {METHODS.map((m) => (
          <SelectItem
            key={m}
            value={m}
            className="font-mono font-semibold tracking-wider"
            style={{ color: COLOR[m] }}
          >
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: COLOR[m] }}
              />
              {m}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
