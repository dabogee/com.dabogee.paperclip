import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "smol-toml";
import { CODEX_SUBSCRIPTION_PROXY_ENV, codexProjectAuthConflicts, codexSubscriptionProxyConfig, codexSubscriptionProxyUrl } from "./codex-subscription-proxy.js";

const url = "http://127.0.0.1:8787/v1";
const headroom = `model_provider = "headroom"
openai_base_url = "${url}"
[model_providers.headroom]
name = "OpenAI"
base_url = "${url}"
requires_openai_auth = true
supports_websockets = true
`;

afterEach(() => vi.unstubAllEnvs());

describe("operator-trusted Codex subscription proxy", () => {
  it("is disabled by default and normalizes an explicit URL", () => {
    vi.stubEnv(CODEX_SUBSCRIPTION_PROXY_ENV, "");
    expect(codexSubscriptionProxyUrl()).toBeUndefined();
    vi.stubEnv(CODEX_SUBSCRIPTION_PROXY_ENV, `${url}/`);
    expect(codexSubscriptionProxyUrl()).toBe(url);
  });

  it.each(["http://proxy.example/v1", "file:///tmp/proxy", "https://user:secret@proxy.example/v1", "https://proxy.example/v1?token=secret", "https://proxy.example/v1#fragment", "not-a-url"])("rejects unsafe operator URL %s", value => {
    vi.stubEnv(CODEX_SUBSCRIPTION_PROXY_ENV, value);
    expect(() => codexSubscriptionProxyUrl()).toThrow(CODEX_SUBSCRIPTION_PROXY_ENV);
  });

  it("renders a Responses provider using the selected OpenAI login, not an API key", () => {
    const config = parse(codexSubscriptionProxyConfig(url));
    expect(config.model_provider).toBe("paperclip_subscription_proxy");
    expect(config.model_providers).toEqual({ paperclip_subscription_proxy: {
      name: "Paperclip trusted subscription proxy", base_url: url, wire_api: "responses",
      requires_openai_auth: true, supports_websockets: false,
    } });
    expect(codexProjectAuthConflicts(codexSubscriptionProxyConfig(url), url)).toBe(false);
  });

  it("accepts Headroom's init config and ignores commented-out credentials", () => {
    expect(codexProjectAuthConflicts(`#env_key = "CODEX_API_KEY"\n${headroom}`, url)).toBe(false);
    expect(codexProjectAuthConflicts('model = "gpt-6.1-sol"\ncli_auth_credentials_store = "file"', url)).toBe(false);
  });

  it.each([
    headroom.replaceAll(url, "http://127.0.0.1:9999/v1"),
    headroom.replace("requires_openai_auth = true", "requires_openai_auth = false"),
    headroom + 'env_key = "OPENAI_API_KEY"',
    headroom + 'experimental_bearer_token = "other-token"',
    headroom + 'http_headers = { Authorization = "other-token" }',
    headroom + 'env_http_headers = { Authorization = "OTHER_TOKEN" }',
    headroom + '\n[profiles.other]\nmodel_provider = "openai"',
    'cli_auth_credentials_store = "keyring"',
    'openai_base_url = "https://other.example/v1"',
    'model_provider = "openai"',
    '[model_providers.broken',
  ])("fails closed for conflicting or malformed project config %#", content => {
    expect(codexProjectAuthConflicts(content, url)).toBe(true);
  });
});
