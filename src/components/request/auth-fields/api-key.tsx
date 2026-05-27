import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AuthFieldProps } from "./shared";

export function ApiKeyFields({ value, onChange, idPrefix }: AuthFieldProps) {
  if (value.kind !== "apiKey") return null;

  return (
    <div className="grid w-full grid-cols-[120px_1fr] items-center gap-x-3 gap-y-2">
      <Label htmlFor={`${idPrefix}-apikey-key`} className="font-medium text-xs">
        Key
      </Label>
      <Input
        id={`${idPrefix}-apikey-key`}
        value={value.key}
        onChange={(e) => onChange({ ...value, key: e.target.value })}
        className="font-mono text-xs"
        placeholder="X-Api-Key"
      />
      <Label htmlFor={`${idPrefix}-apikey-value`} className="font-medium text-xs">
        Value
      </Label>
      <Input
        id={`${idPrefix}-apikey-value`}
        value={value.value}
        onChange={(e) => onChange({ ...value, value: e.target.value })}
        className="font-mono text-xs"
        placeholder="sk-…"
      />
      <Label htmlFor={`${idPrefix}-apikey-in`} className="font-medium text-xs">
        Send in
      </Label>
      <Select value={value.in} onValueChange={(v) => onChange({ ...value, in: v })}>
        <SelectTrigger id={`${idPrefix}-apikey-in`} className="cursor-pointer text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="header" className="cursor-pointer">
            Header
          </SelectItem>
          <SelectItem value="query" className="cursor-pointer">
            Query
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
