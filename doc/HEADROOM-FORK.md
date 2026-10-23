# Paperclip with a trusted Headroom subscription proxy

This fork supports an operator-approved proxy for managed OpenAI subscriptions.
The selected Paperclip connection remains the credential source. No database
edits, API key, separate login, or provider entry in each agent are required.

## Install a GitHub Release package

Download the archive and its `.sha256` file for your operating system and CPU
from this fork's GitHub Releases. Packages are portable runtime distributions,
not npm registry releases. They contain the patched CLI, server, UI, local
Runner and production dependencies, including workspace patches. They do not
fetch an upstream server during installation. Node.js 24.11 or newer is required.

Example for Apple Silicon (replace the version with the downloaded release):

```sh
shasum -a 256 -c paperclip-headroom-v0.1.0-darwin-arm64.tar.gz.sha256
tar -xzf paperclip-headroom-v0.1.0-darwin-arm64.tar.gz
sh paperclip-headroom-v0.1.0-darwin-arm64/install.sh
export PATH="$HOME/.local/bin:$PATH"
paperclipai --version
```

Installation copies this version into `~/.local/lib/` and updates only the
`~/.local/bin/paperclipai` symlink. An existing regular command file is not
overwritten. Existing Paperclip instance data is untouched. Back up the instance
database, encrypted secrets key and storage before starting a newer server:
normal upstream startup migrations still apply. Stop the old server before
starting this one. Run the installed `paperclipai` command, not `npx paperclipai`
(which can select the unpatched npm package). The CLI version remains upstream's;
the archive name and bundled `release.json` identify the fork build.

## Configure the trusted proxy

Start Headroom separately. For a local proxy listening on port 8787, set this
variable in the **Paperclip server process**, then restart Paperclip:

```sh
export PAPERCLIP_CODEX_SUBSCRIPTION_PROXY_URL=http://127.0.0.1:8787/v1
paperclipai run
```

For a managed service, put the variable in its service environment instead.
Connect **OpenAI → Subscription** once in Paperclip: use a personal default or
one company-shared subscription accessible to the intended users and agents.
Do not set `OPENAI_BASE_URL`, API keys, or custom `-c` arguments on the agent.
New Codex agents automatically receive this connection through the existing
creation and hire APIs, including completion of the setup wizard's held record.
No subscription token or Headroom configuration is sent by the API caller.
The existing model selection is unchanged.

### Create an agent without passing provider credentials

Use an authenticated Paperclip API caller authorized to create agents in the
company. The existing endpoint accepts this body:

```http
POST /api/companies/<companyId>/agents
Content-Type: application/json

{
  "name": "Codex engineer",
  "role": "engineer",
  "adapterType": "codex_local",
  "runner": "auto"
}
```

Companies requiring approval use `POST /api/companies/<companyId>/agent-hires`
with the same fields. Both Legacy and native Codex are supported. Paperclip API
authentication remains required; it is separate from OpenAI authentication.

When the trusted proxy is enabled, automatic selection follows these rules:

1. An explicit or inherited managed connection keeps precedence.
2. Otherwise use the responsible user's connected personal OpenAI subscription
   default. An unhealthy or API-key default requires an explicit choice; it never
   silently switches to another person's account.
3. Without a personal default, use the only connected, visible shared OpenAI
   subscription. Multiple candidates require an explicit `runtimeConfig.aiConnection`.
4. If no suitable subscription or responsible identity exists, return an actionable
   error rather than falling back to the server's ambient CLI login.

Human audience, company membership, agent installation and hiring permissions
are still checked. Creating an agent cannot grant itself access to a restricted
shared credential. Existing agents are not rewritten. Explicit credential/home/
provider overrides retain their upstream behavior instead of being silently
replaced by automatic account selection. Disabling the trusted proxy restores
upstream creation defaults.

The setting applies to local Codex subscription runs through both `codex_local`
and the native Paperclip Runner. The generated provider uses Responses and
`requires_openai_auth = true`, with WebSockets disabled. The selected saved
subscription is copied into a private temporary home; normal credential refresh,
grant checks and cleanup remain in place. A changed proxy selects a fresh session.
Usage probes and OAuth token refresh still contact their existing fixed provider
endpoints; they do not pass through this inference proxy.

Without this variable, upstream authentication restrictions remain unchanged.
With it, project/ancestor `.codex/config.toml` files are still checked. Headroom's
matching `model_provider`, `base_url`, `openai_base_url`,
`requires_openai_auth = true`, optional Responses protocol and WebSocket setting
are allowed. A different provider URL, API-key source, auth-header override,
profile override or non-file credential store remains a conflict. Commented-out
settings do not count as active overrides. Inactive custom providers with other
URLs must also be removed from those project/ancestor configs.

Only the server operator can set the trusted address; an agent environment
cannot authorize a proxy. HTTP is accepted only on loopback; other addresses
require HTTPS. URLs containing credentials, a query or fragment are rejected.
The trusted proxy receives subscription bearer tokens and source/prompt content:
use an endpoint you control, secure its logs and do not expose an unauthenticated
listener publicly. This patch is not a sandbox against code running as the
server's OS user. It does not establish provider subscription entitlement or
guarantee compatibility with every Headroom version.

Remote SSH/sandbox execution is not qualified by this fork; existing remote
authentication checks remain restrictive. Loopback addresses refer to the
execution host, not a remote controller. Use the local environment for this setup.

## Build a release

Commit and push the fork changes, then create and push a tag such as
`headroom-v0.1.0`. **Headroom fork release** builds Linux x64 and macOS ARM64/x64
packages and attaches them with checksums to a GitHub Release after all builds
pass. It never publishes to npm and needs no npm token. GitHub's normal
`GITHUB_TOKEN` needs permission to create releases. You can also manually run
the workflow with an existing `headroom-vVERSION` tag. No release is created by
editing these files locally.

The portable packager uses pnpm 9.15.4 `deploy`; run `pnpm build`,
`bash scripts/prepare-server-ui-dist.sh`, and copy `skills/` into `server/skills`
and the Claude/Codex adapter packages before invoking
`node scripts/build-fork-release.mjs headroom-v0.1.0 /tmp/paperclip-release`.
Archives are platform-specific, not cross-platform npm tarballs. Remote daemon
and provider-pack matrices from upstream's public release pipeline are not
included; this distribution targets local agents.
