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
omp plugin install github:rabesss/cline-pass-extension#v0.2.6
```

Pi:

```bash
pi install git:github.com/rabesss/cline-pass-extension@v0.2.6
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
cline-pass/glm-5.2
cline-pass/kimi-k2.7-code
cline-pass/kimi-k2.6
cline-pass/deepseek-v4-pro
cline-pass/deepseek-v4-flash
cline-pass/mimo-v2.5
cline-pass/mimo-v2.5-pro
cline-pass/minimax-m3
cline-pass/qwen3.7-max
cline-pass/qwen3.7-plus
```

All registered models are marked as reasoning-capable, including `xhigh`.
When OMP/Pi passes a reasoning level, the extension forwards it to Cline as
OpenAI-compatible `reasoning_effort`. Streamed `delta.reasoning` content is
emitted back to OMP/Pi as thinking blocks.

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
