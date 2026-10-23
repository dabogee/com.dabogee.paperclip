import { describe, expect, it } from "vitest";
import type { AiManagedConnectionSummary } from "@paperclipai/shared";
import { defaultAiConnectionForHeadroom } from "./agent-ai-connection-default.js";

const shared: AiManagedConnectionSummary = { id: "shared", grantId: "grant", companyId: "company", provider: "openai", method: "subscription", name: "Shared", ownership: "shared", isDefault: false, status: "connected" };
const personal: AiManagedConnectionSummary = { ...shared, id: "personal", grantId: "personal-grant", ownership: "personal", isDefault: true };

describe("automatic Headroom account selection", () => {
  it("selects the personal default before shared subscriptions", () => {
    expect(defaultAiConnectionForHeadroom({}, [shared, personal])).toEqual({ provider: "openai", method: "subscription", mode: "responsible_user" });
  });
  it("selects the only healthy shared subscription", () => {
    expect(defaultAiConnectionForHeadroom({}, [shared, { ...personal, isDefault: false }])).toEqual({ provider: "openai", method: "subscription", mode: "shared", connectionId: shared.id, grantId: shared.grantId });
  });
  it.each(["revoked", "expired", "needs_attention"] as const)("does not replace a %s personal default with someone else's account", status => {
    expect(() => defaultAiConnectionForHeadroom({}, [shared, { ...personal, status }])).toThrow("personal default");
  });
  it("does not silently replace a personal API-key default", () => {
    expect(() => defaultAiConnectionForHeadroom({}, [shared, { ...personal, method: "api_key" }])).toThrow("personal default");
  });
  it("requires an explicit choice when several shared subscriptions exist", () => {
    expect(() => defaultAiConnectionForHeadroom({}, [shared, { ...shared, id: "second" }])).toThrow("Several shared");
  });
  it("never falls back to ambient authentication when no account is available", () => {
    expect(() => defaultAiConnectionForHeadroom({}, [])).toThrow("Connect an OpenAI subscription");
  });
  it.each(["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_HOME", "OPENAI_BASE_URL", "PAPERCLIP_CODEX_PROVIDERS"])("preserves an explicit %s", key => {
    expect(defaultAiConnectionForHeadroom({ env: { [key]: { type: "secret_ref", secretId: "explicit" } } }, [])).toBeUndefined();
  });
  it("treats an empty inherited key override as unauthenticated", () => {
    expect(defaultAiConnectionForHeadroom({ env: { OPENAI_API_KEY: { type: "plain", value: "" } } }, [personal])?.mode).toBe("responsible_user");
  });
  it("preserves explicit provider configuration arguments", () => {
    expect(defaultAiConnectionForHeadroom({ extraArgs: ["-c", "model_provider=other"] }, [])).toBeUndefined();
  });
});
