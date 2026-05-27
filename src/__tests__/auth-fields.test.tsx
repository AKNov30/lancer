import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ApiKeyFields } from "@/components/request/auth-fields/api-key";
import { AwsSigV4Fields } from "@/components/request/auth-fields/aws-sigv4";
import { BasicFields } from "@/components/request/auth-fields/basic";
import { OAuth2CcFields } from "@/components/request/auth-fields/oauth2-cc";
import type { AuthFieldProps } from "@/components/request/auth-fields/shared";
import type { Auth } from "@/lib/types";

/**
 * Drive a controlled auth-fields component with local state so we can assert
 * what `onChange` produces. `latest` mirrors the most recent value the
 * component reported, replacing the old store-coupled assertions.
 */
function Controlled({
  initial,
  render: renderFields,
}: {
  initial: Auth;
  render: (props: AuthFieldProps) => React.ReactNode;
}) {
  const [value, setValue] = useState<Auth>(initial);
  return <>{renderFields({ value, onChange: setValue, idPrefix: "test" })}</>;
}

describe("BasicFields", () => {
  it("reports username + password via onChange", async () => {
    const user = userEvent.setup();
    let latest: Auth = { kind: "basic", username: "", password: "" };
    render(
      <Controlled
        initial={latest}
        render={(p) => {
          latest = p.value;
          return <BasicFields {...p} />;
        }}
      />,
    );
    await user.type(screen.getByLabelText(/username/i), "alice");
    await user.type(screen.getByLabelText(/password/i), "secret");
    expect(latest).toMatchObject({ kind: "basic", username: "alice", password: "secret" });
  });
});

describe("ApiKeyFields", () => {
  it("reports key + value via onChange", async () => {
    const user = userEvent.setup();
    let latest: Auth = { kind: "apiKey", key: "", value: "", in: "header" };
    render(
      <Controlled
        initial={latest}
        render={(p) => {
          latest = p.value;
          return <ApiKeyFields {...p} />;
        }}
      />,
    );
    await user.type(screen.getByLabelText(/^key$/i), "X-Api-Key");
    await user.type(screen.getByLabelText(/value/i), "abc-123");
    expect(latest).toMatchObject({
      kind: "apiKey",
      key: "X-Api-Key",
      value: "abc-123",
      in: "header",
    });
  });
});

describe("OAuth2CcFields", () => {
  it("reports tokenUrl via onChange", async () => {
    const user = userEvent.setup();
    let latest: Auth = {
      kind: "oAuth2Cc",
      tokenUrl: "",
      clientId: "",
      clientSecret: "",
      scope: "",
      audience: "",
    };
    render(
      <Controlled
        initial={latest}
        render={(p) => {
          latest = p.value;
          return <OAuth2CcFields {...p} />;
        }}
      />,
    );
    await user.type(screen.getByLabelText(/token url/i), "https://auth/token");
    expect(latest).toMatchObject({ kind: "oAuth2Cc", tokenUrl: "https://auth/token" });
  });
});

describe("AwsSigV4Fields", () => {
  it("reports accessKeyId + region + service via onChange", async () => {
    const user = userEvent.setup();
    let latest: Auth = {
      kind: "awsSigV4",
      accessKeyId: "",
      secretAccessKey: "",
      sessionToken: "",
      region: "",
      service: "",
    };
    render(
      <Controlled
        initial={latest}
        render={(p) => {
          latest = p.value;
          return <AwsSigV4Fields {...p} />;
        }}
      />,
    );
    await user.type(screen.getByLabelText(/access key id/i), "AKIA1234");
    await user.type(screen.getByLabelText(/^region$/i), "us-east-1");
    await user.type(screen.getByLabelText(/^service$/i), "lambda");
    expect(latest).toMatchObject({
      kind: "awsSigV4",
      accessKeyId: "AKIA1234",
      region: "us-east-1",
      service: "lambda",
    });
  });
});
