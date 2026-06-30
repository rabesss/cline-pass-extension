# Cline Pass Provider

Dependency-free Pi and OMP provider extension for Cline Pass.

It registers a `cline-pass` provider backed by Cline's OpenAI-compatible API.
Sign in with `/login` and choose `Cline Pass`.

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
omp plugin install github:rabesss/cline-pass-extension#v0.2.5
```

Pi:

```bash
pi install git:github.com/rabesss/cline-pass-extension@v0.2.5
```

## Authentication

Run `/login`, select `Cline Pass`, and sign in with your Cline account in the
browser. API keys are also supported through the `/login` fallback or
`CLINE_PASS_API_KEY`.

`/login` uses the same Cline account device authorization flow as the Cline CLI,
then stores the resulting provider credentials in OMP/Pi. Set
`CLINE_PASS_LOGIN_MODE=api-key` to skip browser sign-in and paste an API key
directly.

Default token lookup order:

```text
CLINE_PASS_API_KEY
CLINE_API_KEY
CLINE_PASS_ACCESS_TOKEN
saved OMP/Pi /login credential
```

When `CLINE_PASS_IMPORT_LOCAL=1` is set, the extension can also inspect local
Cline settings:

```text
CLINE_PROVIDERS_JSON
CLINE_DATA_DIR/settings/providers.json
~/.cline/data/settings/providers.json
```

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
`/login` stores only the Cline account or API-key credential returned through
OMP/Pi. Local Cline provider tokens are only read when you explicitly set
`CLINE_PASS_IMPORT_LOCAL=1`.
