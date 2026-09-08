# OrcaRouter provider (opt-in)

LazyClaude's OrcaRouter integration is a thin launcher configuration for
Claude Code. It does not add an OAuth flow, an Anthropic/OrcaRouter SDK, or a
new persistent provider setting. The ordinary command remains unchanged:

```bash
lazyclaude run -- [Claude args]
```

To opt into OrcaRouter for one child process, use:

```bash
node bin/lazyclaude.js run --provider orcarouter -- [Claude args]
```

The provider requires all four environment variables:

```text
ORCAROUTER_API_KEY=<your-key>
ORCAROUTER_OPUS_MODEL=<current-opus-model-id>
ORCAROUTER_SONNET_MODEL=<current-sonnet-model-id>
ORCAROUTER_HAIKU_MODEL=<current-haiku-model-id>
```

The model values above are placeholders, not a verified model list. Choose
model IDs currently supported by your OrcaRouter account/catalog. Do not put a
real key or account-specific model IDs in the repository.

## What the provider changes

For the child Claude Code process only, the launcher sets the bare base host
`https://api.orcarouter.ai` (without `/v1`) and the Anthropic authentication
token, then maps the `opus`, `sonnet`, and `haiku` aliases from the three model
environment variables. Claude Code appends its API path. The child starts on
the configured Sonnet alias; a Claude Code `--model` override is forwarded to
the child unchanged.

The child drops conflicting authentication, custom headers, model overrides,
and cloud-provider switches inherited from the shell. It also sets
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` to limit background traffic on
older clients; this disables auto-updates for that session. Keep Claude Code
updated separately. Proxy and certificate settings are preserved.

The parent shell environment and LazyClaude defaults are not rewritten, and
the provider is not persisted. Existing Claude Code settings or managed policy
can override the endpoint, credentials, and model environment variables.
Before sending a prompt, run `/status` and verify the Anthropic base URL is
`https://api.orcarouter.ai` and the credential source is
`ANTHROPIC_AUTH_TOKEN`. Stop if they differ: a conflicting endpoint could
receive the gateway credential. Review your user/project `env` settings or
ask your administrator to resolve managed settings. This launcher is not a
settings sandbox and does not configure supervisor-hosted background agents,
other terminals, or editor sessions. See Claude Code's
[gateway connection guide](https://code.claude.com/docs/en/llm-gateway-connect).

OrcaRouter's integration documentation describes the base-host format in
[Claude Code integrations](https://docs.orcarouter.ai/integrations/claude-code),
Anthropic SDK compatibility in
[compatibility/anthropic-sdk](https://docs.orcarouter.ai/compatibility/anthropic-sdk),
and response/request metadata in
[routing/response-headers](https://docs.orcarouter.ai/routing/response-headers).
Claude's model configuration reference is
[here](https://code.claude.com/docs/en/model-config).

Anthropic's [other gateways guidance](https://code.claude.com/docs/en/llm-gateway)
states that Anthropic does not support routing Claude Code to non-Claude
models through a gateway. Start with Claude-family model mappings and treat
any broader OrcaRouter catalog or non-Claude upstream routing as unverified
and unsupported by Anthropic. A compatible endpoint alone is not proof that
every model or Claude Code capability is supported.

## Secret handling

Use a temporary environment and remove it after the launcher exits. In Bash,
the prompt below avoids echoing the key:

```bash
read -rs ORCAROUTER_API_KEY
export ORCAROUTER_API_KEY
export ORCAROUTER_OPUS_MODEL='<current-opus-model-id>'
export ORCAROUTER_SONNET_MODEL='<current-sonnet-model-id>'
export ORCAROUTER_HAIKU_MODEL='<current-haiku-model-id>'
node bin/lazyclaude.js run --provider orcarouter -- --help
unset ORCAROUTER_API_KEY ORCAROUTER_OPUS_MODEL ORCAROUTER_SONNET_MODEL ORCAROUTER_HAIKU_MODEL
```

PowerShell can prompt as a `SecureString`, convert only for the child
environment, and clean up afterward:

```powershell
$orcaSecret = Read-Host 'ORCAROUTER_API_KEY' -AsSecureString
$orcaCredential = [pscredential]::new('orca', $orcaSecret)
$env:ORCAROUTER_API_KEY = $orcaCredential.GetNetworkCredential().Password
$env:ORCAROUTER_OPUS_MODEL = '<current-opus-model-id>'
$env:ORCAROUTER_SONNET_MODEL = '<current-sonnet-model-id>'
$env:ORCAROUTER_HAIKU_MODEL = '<current-haiku-model-id>'
node bin/lazyclaude.js run --provider orcarouter -- --help
Remove-Item Env:ORCAROUTER_API_KEY, Env:ORCAROUTER_OPUS_MODEL, Env:ORCAROUTER_SONNET_MODEL, Env:ORCAROUTER_HAIKU_MODEL -ErrorAction SilentlyContinue
Remove-Variable orcaSecret, orcaCredential -ErrorAction SilentlyContinue
```

The key necessarily exists in the launched process environment while Claude
Code runs. Avoid shell history, committed `.env` files, logs, screenshots, and
copying the value into prompts.

## Source-checkout setup and Windows

This provider documentation describes the source checkout launcher. Clone
the repository, install the plugin, then configure the variables above:

```bash
git clone https://github.com/oocheol/lazyclaude.git
cd lazyclaude
node bin/lazyclaude.js install
```

Use this source launcher for the new provider flags; availability in the
published npm `v0.1.2` package has not been verified. On Windows, `run`
requires a native `claude.exe`; it rejects `.cmd`/`.bat` shims because the
launcher does not pass arbitrary arguments through a shell. Set
`LAZYCLAUDE_CLAUDE_BIN` to a native executable when needed, or invoke
`claude.exe` directly with the installed plugin directory.

## Verification status and checklist

The following are the intended live checks for each configured alias/tier:

- opus, sonnet, and haiku routing, including a Sonnet startup and `--model`
  override;
- subagent execution and tool calling;
- streaming and thinking behavior;
- Claude Code/version, model ID, and OrcaRouter `X-Orca-Request-Id` capture.

All live checks are pending testing credits (balance confirmed as 0 on
2026-09-08). Offline launcher checks are not end-to-end proof of provider
routing, API responses, streaming, thinking, or request IDs.

After credits and a scoped API key are available, use a disposable checkout
with no secrets for live checks. Each command can incur inference charges.
Record the Claude Code version, selected and resolved model IDs, outcome,
timestamp, and request ID from OrcaRouter's request logs; never share tokens
or unsanitized debug logs.

| Check | Reproduction | Pass evidence |
| --- | --- | --- |
| Alias routing | Launch with `-- --model opus -p "Reply with exactly OK"`; repeat for `sonnet` and `haiku` | Request log resolves each configured model |
| Subagent | Ask Claude to delegate a read-only file summary to LazyClaude's Explorer | Child task completes; its model matches the Sonnet mapping |
| Tool calling | Ask Claude to read a harmless fixture file using its file tool | Actual tool result is consumed in the answer |
| Streaming | Request a short answer with `-- -p --verbose --output-format stream-json --include-partial-messages` | Incremental events followed by a completed result |
| Thinking | Use a supported Claude model and its documented reasoning setting on a small reasoning task | No protocol error; inspect available thinking events/usage without requiring private reasoning text |

These are test procedures, not completed results. If a check fails, send
the sanitized reproduction and `X-Orca-Request-Id` to OrcaRouter support.

Referral disclosure: using the optional [public OrcaRouter referral
link](https://www.orcarouter.ai/ref/ref_d7de05b7c0ee9440f978) may allow the
project to earn 5% of eligible paid inference spend under the program terms.
BYOK usage is excluded per the vendor's email. This does not include a Claude
subscription, and referral signup is not required. See
[Built with OrcaRouter](https://www.orcarouter.ai/built-with).
