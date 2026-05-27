import { useRequest } from "@/stores/request-store";
import { AuthEditor } from "./auth-fields/auth-editor";

export function AuthPanel() {
  const auth = useRequest((s) => s.auth);
  const setAuth = useRequest((s) => s.setAuth);

  return (
    <AuthEditor
      value={auth}
      onChange={setAuth}
      idPrefix="req"
      noneState={
        <>
          <div className="grid size-10 place-items-center rounded-full bg-card shadow-sm ring-1 ring-border">
            <span aria-hidden="true" className="text-muted-foreground/60 text-base">
              ⊘
            </span>
          </div>
          <p className="font-medium text-foreground text-sm">No authentication</p>
          <p className="max-w-[32ch] text-muted-foreground/70 text-xs">
            Requests on this tab will be sent without an Authorization header.
          </p>
        </>
      }
    />
  );
}
