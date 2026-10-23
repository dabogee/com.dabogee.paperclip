import { parse } from "smol-toml";
import { unprocessable } from "../errors.js";

export const CODEX_SUBSCRIPTION_PROXY_ENV = "PAPERCLIP_CODEX_SUBSCRIPTION_PROXY_URL";

/** Only the server operator can authorize a recipient of subscription tokens. */
export function codexSubscriptionProxyUrl(): string | undefined {
  const value = process.env[CODEX_SUBSCRIPTION_PROXY_ENV]?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username || url.password || url.search || url.hash) throw new Error();
    return url.href.replace(/\/$/, "");
  } catch {
    throw unprocessable(`${CODEX_SUBSCRIPTION_PROXY_ENV} must be an HTTPS URL or loopback HTTP URL without credentials, query or fragment`, {
      code: "ai_connection_incompatible",
    });
  }
}

export function codexSubscriptionProxyConfig(url: string): string {
  return `model_provider = "paperclip_subscription_proxy"
openai_base_url = ${JSON.stringify(url)}
[model_providers.paperclip_subscription_proxy]
name = "Paperclip trusted subscription proxy"
base_url = ${JSON.stringify(url)}
wire_api = "responses"
requires_openai_auth = true
supports_websockets = false
`;
}

/** Permit matching routing, never project-owned credentials or auth headers. */
export function codexProjectAuthConflicts(content: string, trustedUrl: string): boolean {
  try {
    const config = parse(content);
    const providers = config.model_providers;
    if (providers && typeof providers === "object" && !Array.isArray(providers)) {
      for (const [name, value] of Object.entries(providers)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return true;
        const provider = value as Record<string, unknown>;
        if (provider.base_url !== trustedUrl && provider.base_url !== `${trustedUrl}/`) return true;
        if (provider.requires_openai_auth !== true ||
          (provider.wire_api !== undefined && provider.wire_api !== "responses") ||
          Object.keys(provider).some(key => !["name", "base_url", "wire_api", "requires_openai_auth", "supports_websockets"].includes(key))) return true;
        if (config.model_provider === name) delete config.model_provider;
      }
      delete config.model_providers;
    }
    if (config.openai_base_url === trustedUrl || config.openai_base_url === `${trustedUrl}/`) delete config.openai_base_url;
    if (config.cli_auth_credentials_store === "file") delete config.cli_auth_credentials_store;
    const hasOverride = (value: unknown): boolean => {
      if (!value || typeof value !== "object") return false;
      return Object.entries(value).some(([key, child]) =>
        /apiKeyHelper|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|OPENAI_API_KEY|CODEX_API_KEY|model_provider|env_key|bearer_token|cli_auth_credentials_store|openai_base_url|http_headers|env_http_headers/.test(key) || hasOverride(child));
    };
    return hasOverride(config);
  } catch {
    return true;
  }
}
