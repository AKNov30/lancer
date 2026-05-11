import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiKeyFields } from "@/components/request/auth-fields/api-key";
import { AwsSigV4Fields } from "@/components/request/auth-fields/aws-sigv4";
import { BasicFields } from "@/components/request/auth-fields/basic";
import { OAuth2CcFields } from "@/components/request/auth-fields/oauth2-cc";
import type { Auth } from "@/lib/types";
import { useRequest } from "@/stores/request-store";

function resetStore(auth: Auth) {
  useRequest.setState({
    request: { url: "", method: "GET", headers: [], query: [] },
    auth,
    response: null,
    loading: false,
    error: null,
  });
}

describe("BasicFields", () => {
  beforeEach(() => resetStore({ kind: "basic", username: "", password: "" }));

  it("writes username + password to store", async () => {
    const user = userEvent.setup();
    render(<BasicFields />);
    await user.type(screen.getByLabelText(/username/i), "alice");
    await user.type(screen.getByLabelText(/password/i), "secret");
    const auth = useRequest.getState().auth;
    expect(auth).toMatchObject({ kind: "basic", username: "alice", password: "secret" });
  });
});

describe("ApiKeyFields", () => {
  beforeEach(() => resetStore({ kind: "apiKey", key: "", value: "", in: "header" }));

  it("writes key + value to store", async () => {
    const user = userEvent.setup();
    render(<ApiKeyFields />);
    await user.type(screen.getByLabelText(/^key$/i), "X-Api-Key");
    await user.type(screen.getByLabelText(/value/i), "abc-123");
    const auth = useRequest.getState().auth;
    expect(auth).toMatchObject({
      kind: "apiKey",
      key: "X-Api-Key",
      value: "abc-123",
      in: "header",
    });
  });
});

describe("OAuth2CcFields", () => {
  beforeEach(() =>
    resetStore({
      kind: "oAuth2Cc",
      tokenUrl: "",
      clientId: "",
      clientSecret: "",
      scope: "",
      audience: "",
    }),
  );

  it("writes tokenUrl to store", async () => {
    const user = userEvent.setup();
    render(<OAuth2CcFields />);
    await user.type(screen.getByLabelText(/token url/i), "https://auth/token");
    const auth = useRequest.getState().auth;
    expect(auth).toMatchObject({ kind: "oAuth2Cc", tokenUrl: "https://auth/token" });
  });
});

describe("AwsSigV4Fields", () => {
  beforeEach(() =>
    resetStore({
      kind: "awsSigV4",
      accessKeyId: "",
      secretAccessKey: "",
      sessionToken: "",
      region: "",
      service: "",
    }),
  );

  it("writes accessKeyId + region + service to store", async () => {
    const user = userEvent.setup();
    render(<AwsSigV4Fields />);
    await user.type(screen.getByLabelText(/access key id/i), "AKIA1234");
    await user.type(screen.getByLabelText(/^region$/i), "us-east-1");
    await user.type(screen.getByLabelText(/^service$/i), "lambda");
    const auth = useRequest.getState().auth;
    expect(auth).toMatchObject({
      kind: "awsSigV4",
      accessKeyId: "AKIA1234",
      region: "us-east-1",
      service: "lambda",
    });
  });
});
