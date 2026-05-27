import type { Auth } from "@/lib/types";

export type AuthKind = Auth["kind"];

/**
 * Pristine value for each auth kind. Single source of truth shared by the
 * request `AuthPanel` and the folder `CollectionAuthEditor` so switching tabs
 * resets to the same empty shape in both surfaces.
 */
export const EMPTY: Record<AuthKind, Auth> = {
  none: { kind: "none" },
  bearer: { kind: "bearer", token: "" },
  basic: { kind: "basic", username: "", password: "" },
  apiKey: { kind: "apiKey", key: "", value: "", in: "header" },
  oAuth2Cc: {
    kind: "oAuth2Cc",
    tokenUrl: "",
    clientId: "",
    clientSecret: "",
    scope: "",
    audience: "",
  },
  awsSigV4: {
    kind: "awsSigV4",
    accessKeyId: "",
    secretAccessKey: "",
    sessionToken: "",
    region: "",
    service: "",
  },
};

/** Ordered auth-kind tabs rendered by both auth editors. */
export const AUTH_TABS: { value: AuthKind; label: string }[] = [
  { value: "none", label: "None" },
  { value: "bearer", label: "Bearer" },
  { value: "basic", label: "Basic" },
  { value: "apiKey", label: "API Key" },
  { value: "oAuth2Cc", label: "OAuth 2" },
  { value: "awsSigV4", label: "AWS" },
];

/**
 * Controlled-field props shared by every `auth-fields/*` component. Each reads
 * the current {@link Auth} from `value` and reports edits via `onChange`, so the
 * same field group serves both the per-request and per-folder auth editors.
 * `idPrefix` keeps element `id`/`htmlFor` pairs unique between the two surfaces.
 */
export interface AuthFieldProps {
  value: Auth;
  onChange: (auth: Auth) => void;
  idPrefix: string;
}
