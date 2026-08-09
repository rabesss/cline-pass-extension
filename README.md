# Cline Pass Provider

Dependency-free OMP and Pi provider extension for Cline Pass.

It registers a `cline-pass` provider backed by Cline's OpenAI-compatible API.
Sign in with `/login` and choose `Cline Pass`.

## Support Scope

This extension currently supports **Cline Pass inference only**. It registers
the `cline-pass` provider and the `cline-pass/*` model selectors listed below.

The extension accepts Cline API keys through `/login` or environment variables.
It can also reuse an existing local Cline account access token when explicitly
opted in. Those are credential sources for Cline Pass requests; they do not add
a separate `cline` provider or Cline's regular/free model selectors.

## Run From Source

Build once:

```bash
git clone https://github.com/rabesss/cline-pass-extension.git
cd cline-pass-extension
npm install
npm run build
```

Load it in OMP:

```bash
omp -e ./dist/extension.js
```

Or load it in Pi:

```bash
pi -e ./dist/extension.js
```

If first-run onboarding shows only built-in providers, skip setup and use
`/login` in the normal session.

## Install As A Plugin

OMP:

```bash
omp plugin install github:rabesss/cline-pass-extension#v0.2.7
```

Pi:

```bash
pi install git:github.com/rabesss/cline-pass-extension@v0.2.7
```

## Authentication

Run `/login`, select `Cline Pass`, and paste a Cline API key from:

```text
https://app.cline.bot/settings/api-keys
```

You can also set `CLINE_PASS_API_KEY`.

Default token lookup order:

```text
CLINE_PASS_API_KEY
CLINE_API_KEY
CLINE_PASS_ACCESS_TOKEN
saved OMP/Pi /login API-key credential
```

When `CLINE_PASS_IMPORT_LOCAL=1` is set, the extension can also inspect local
Cline settings for an existing Cline account token:

```text
CLINE_PROVIDERS_JSON
CLINE_DATA_DIR/settings/providers.json
~/.cline/data/settings/providers.json
```

Local Cline settings are read-only. The extension does not run Cline account
login, does not call Cline's token refresh endpoint, and does not write back to
`providers.json`. If the imported local token is expired, refresh or sign in
with the Cline app and try again, or use a Cline API key.

Use `/clinepass doctor` to check which auth sources are visible.

## Provider And Models

The extension registers provider `cline-pass`:

```text
https://api.cline.bot/api/v1
```

Selectors include:

```text
cline-pass/deepseek-v4-flash
cline-pass/qwen3.8-max
cline-pass/kimi-k3
cline-pass/deepseek-v4-pro
cline-pass/glm-5.2
cline-pass/kimi-k2.7-code
cline-pass/kimi-k2.6
cline-pass/mimo-v2.5-pro
cline-pass/mimo-v2.5
cline-pass/minimax-m3
cline-pass/qwen3.7-max
cline-pass/qwen3.7-plus
```

The order follows Cline's live Cline Pass recommendation endpoint. Each model's
context window, maximum output, input modalities, and supported reasoning
options (effort, toggle, or token budget) come from the matching models.dev
catalog row. The extension only forwards `reasoning_effort` when that exact
effort is advertised upstream;
Kimi K3 exposes OMP's current `low`, `high`, and `max` levels (`xhigh` remains a
backward-compatible alias for `max`), and toggle-only reasoning models receive
no unsupported effort value. The catalog preserves those models' upstream
reasoning capability, but the OMP-facing `reasoning` control is enabled only
when the source publishes concrete effort choices; otherwise current OMP would
invent generic effort levels. Streamed `delta.reasoning` content is still
emitted back to OMP/Pi as thinking blocks for every model.

Vision is enabled for Qwen3.8 Max, Kimi K3, Kimi K2.7 Code, Kimi K2.6,
MiMo-V2.5, MiniMax M3, and Qwen3.7 Plus. OMP/Pi image blocks are serialized as
OpenAI-compatible `image_url` data URLs. Although some upstream rows advertise
audio or video, this extension exposes only text and image because those are the
input types supported by its OMP/Pi message adapter.

The catalog advertises the real upstream output limits, but ordinary requests
retain a conservative 16,384-token default. An explicit lower or higher
`maxTokens` request is honored up to the selected model's advertised limit.

### Catalog Sources And Pricing

`models.json` is a reviewed offline snapshot. Runtime registration does not
fetch the network. Selector IDs, OMP-supported input modes, reasoning efforts,
and flat display costs are derived from the wire ID, source modalities,
reasoning options, and first pricing tier instead of being duplicated in every
catalog row. Its source boundaries are:

- Cline's public recommended-models endpoint: current Cline Pass membership,
  display descriptions, and ordering.
- Cline's ClinePass documentation: subscription reference prices per one
  million tokens, including cache rates and context-dependent tiers.
- models.dev's OpenRouter catalog: context/output limits, reasoning controls,
  input modalities, tool support, and a pricing fallback for a live model not
  yet present in Cline's pricing table.

Cline Pass remains a flat subscription with usage limits; these prices are
reference quota values, not an additional pay-as-you-go bill. OMP/Pi accepts one
flat model-metadata rate per token dimension, so it displays the first documented
tier. The adapter's usage accounting selects the matching context tier; all tiers
remain preserved in `models.json`. A missing cache rate is stored as unsupported
rather than treated as a source price of zero.

At the current snapshot, Qwen3.8 Max is live but absent from Cline's pricing
table, so its row explicitly uses the matching models.dev rate as a fallback.

Check the three public sources without changing `models.json`:

```bash
npm run models:check
npm run models:proposal
```

Both commands are read-only. `models:check` distinguishes clean, catalog drift,
transient network failure, and structural extraction failure. `models:proposal`
prints a deterministic diff with `writesPerformed: false`. The scheduled GitHub
workflow runs the same drift check.

## Commands

```text
/clinepass doctor
/clinepass models
/clinepass verify
```

`doctor` checks whether usable auth or local Cline settings are visible.
`verify` sends a tiny request to Cline's API.

Useful options:

```text
--model <id>      Verification model, default glm-5.2
--base-url <url>  Cline API base URL override
--json            Return JSON
```

## Safety

The extension never prints Cline access or refresh tokens in command output.
`/login` stores only the API-key credential returned through OMP/Pi. Local
Cline provider tokens are only read when you explicitly set
`CLINE_PASS_IMPORT_LOCAL=1`, and they are never modified by this extension.
