import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthFieldProps } from "./shared";

export function BearerFields({ value, onChange, idPrefix }: AuthFieldProps) {
  if (value.kind !== "bearer") return null;

  return (
    <div className="grid w-full grid-cols-[120px_1fr] items-center gap-x-3 gap-y-2">
      <Label htmlFor={`${idPrefix}-bearer-token`} className="font-medium text-xs">
        Token
      </Label>
      <Input
        id={`${idPrefix}-bearer-token`}
        value={value.token}
        onChange={(e) => onChange({ kind: "bearer", token: e.target.value })}
        className="font-mono text-xs"
        placeholder="ey…"
      />
    </div>
  );
}
