import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthFieldProps } from "./shared";

export function BasicFields({ value, onChange, idPrefix }: AuthFieldProps) {
  if (value.kind !== "basic") return null;

  return (
    <div className="grid w-full grid-cols-[120px_1fr] items-center gap-x-3 gap-y-2">
      <Label htmlFor={`${idPrefix}-basic-username`} className="font-medium text-xs">
        Username
      </Label>
      <Input
        id={`${idPrefix}-basic-username`}
        value={value.username}
        onChange={(e) => onChange({ ...value, username: e.target.value })}
        className="font-mono text-xs"
      />
      <Label htmlFor={`${idPrefix}-basic-password`} className="font-medium text-xs">
        Password
      </Label>
      <Input
        id={`${idPrefix}-basic-password`}
        type="password"
        value={value.password}
        onChange={(e) => onChange({ ...value, password: e.target.value })}
        className="font-mono text-xs"
      />
    </div>
  );
}
