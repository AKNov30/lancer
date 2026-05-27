import type { Auth } from "@/lib/types";
import { AuthEditor } from "./request/auth-fields/auth-editor";

/**
 * Controlled Authorization editor used by the collection (folder) settings
 * sheet. Mirrors the request `AuthPanel` UI but is driven by `value`/`onChange`
 * props instead of the request store — so a folder's default auth can be edited
 * without touching per-request auth state. Auth set here cascades to requests
 * inside the folder that have no explicit auth of their own.
 */
export function CollectionAuthEditor({
  value,
  onChange,
}: {
  value: Auth;
  onChange: (auth: Auth) => void;
}) {
  return (
    <AuthEditor
      value={value}
      onChange={onChange}
      idPrefix="coll"
      noneState={
        <>
          <div className="grid size-10 place-items-center rounded-full bg-card shadow-sm ring-1 ring-border">
            <span aria-hidden="true" className="text-muted-foreground/60 text-base">
              ⊘
            </span>
          </div>
          <p className="font-medium text-foreground text-sm">No default authentication</p>
          <p className="max-w-[36ch] text-muted-foreground/70 text-xs">
            Requests in this folder fall back to their own auth (or none). Pick a mode to set a
            default that requests without explicit auth inherit.
          </p>
        </>
      }
    />
  );
}
