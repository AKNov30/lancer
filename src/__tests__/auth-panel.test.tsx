import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { AuthPanel } from "@/components/request/auth-panel";
import { useRequest } from "@/stores/request-store";

describe("AuthPanel", () => {
  beforeEach(() => {
    useRequest.setState({
      request: {
        url: "",
        method: "GET",
        headers: [],
        query: [],
        body: { kind: "none" },
        options: {},
        vars: [],
        captures: [],
      },
      auth: { kind: "none" },
      response: null,
      loading: false,
      error: null,
    });
  });

  it("renders all six auth tabs", () => {
    render(<AuthPanel />);
    for (const label of ["None", "Bearer", "Basic", "API Key", "OAuth 2", "AWS"]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
  });

  it("switches auth kind in the store when tab changes", async () => {
    const user = userEvent.setup();
    render(<AuthPanel />);
    await user.click(screen.getByRole("tab", { name: "Bearer" }));
    expect(useRequest.getState().auth.kind).toBe("bearer");
    await user.click(screen.getByRole("tab", { name: "AWS" }));
    expect(useRequest.getState().auth.kind).toBe("awsSigV4");
  });

  it("writes token edits back to the store", async () => {
    const user = userEvent.setup();
    useRequest.setState((s) => ({ ...s, auth: { kind: "bearer", token: "" } }));
    render(<AuthPanel />);
    const input = screen.getByPlaceholderText("ey…");
    await user.type(input, "abc.def.ghi");
    const auth = useRequest.getState().auth;
    expect(auth.kind).toBe("bearer");
    if (auth.kind === "bearer") expect(auth.token).toBe("abc.def.ghi");
  });
});
