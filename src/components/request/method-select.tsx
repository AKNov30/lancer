import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { METHOD_COLOR } from "@/lib/method-color";
import { METHODS, type Method } from "@/lib/types";

interface Props {
  value: Method;
  onChange: (m: Method) => void;
}

export function MethodSelect({ value, onChange }: Props) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Method)}>
      <SelectTrigger
        className="group w-[124px] cursor-pointer gap-2 font-mono font-semibold tracking-wider transition-all duration-150 hover:shadow-sm focus:shadow-[var(--shadow-glow)]"
        style={{
          color: METHOD_COLOR[value],
          backgroundImage: `linear-gradient(135deg, color-mix(in oklch, ${METHOD_COLOR[value]} 10%, transparent), color-mix(in oklch, ${METHOD_COLOR[value]} 4%, transparent))`,
          borderColor: `color-mix(in oklch, ${METHOD_COLOR[value]} 28%, var(--color-border))`,
        }}
        aria-label={`HTTP method, currently ${value}`}
      >
        {/*
          The dot lives on the trigger only. The dropdown items color the text
          instead — putting a dot inside `<SelectItem>` would render it twice,
          because Radix's `<SelectValue />` mirrors the selected item's children
          back into the trigger (shadcn's SelectItem wraps everything in
          `ItemText` automatically).
        */}
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full"
          style={{
            backgroundColor: METHOD_COLOR[value],
            boxShadow: `0 0 8px ${METHOD_COLOR[value]}, 0 0 0 2px color-mix(in oklch, ${METHOD_COLOR[value]} 25%, transparent)`,
          }}
        />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {METHODS.map((m) => (
          <SelectItem
            key={m}
            value={m}
            className="cursor-pointer font-mono font-semibold tracking-wider transition-colors"
            style={{ color: METHOD_COLOR[m] }}
          >
            {m}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
