# Cline Pass Provider

Dependency-free Pi and OMP provider extension for Cline Pass.

This package talks directly to Cline's OpenAI-compatible API. It does not use CLIProxyAPI.

For auth, run OMP/Pi `/login` for `Cline Pass` and sign in with your Cline account in the browser. API keys still work through the `/login` fallback or `CLINE_PASS_API_KEY`. Existing Cline local auth can be inspected with `/clinepass doctor`; local Cline account-token reuse is disabled by default and can be tried with `CLINE_PASS_IMPORT_LOCAL=1`.

## Custom Extension

Build once, then load the extension explicitly:

```bash
git clone https://github.com/rabesss/cline-pass-extension.git
cd cline-pass-extension
npm install
npm run build
omp -e ./dist/extension.js
```

```bash
pi -e ./dist/extension.js
```

After OMP/Pi starts with `-e`, run `/login` and select `Cline Pass`. First-run onboarding may show only built-in providers; skip setup and use `/login` in the normal session.

## Optional Install

```bash
omp plugin install github:rabesss/cline-pass-extension#v0.2.3
```

```bash
pi install git:github.com/rabesss/cline-pass-extension@v0.2.3
```

## Provider

The extension registers provider `cline-pass` with Cline's direct API:

```text
https://api.cline.bot/api/v1
```

Selectors include:

```text
cline-pass/glm-5.2
cline-pass/kimi-k2.7-code
cline-pass/deepseek-v4-pro
cline-pass/qwen3.7-max
```

Token lookup order:

```text
CLINE_PASS_API_KEY
CLINE_API_KEY
CLINE_PASS_ACCESS_TOKEN
CLINE_PROVIDERS_JSON, if CLINE_PASS_IMPORT_LOCAL=1
CLINE_DATA_DIR/settings/providers.json, if CLINE_PASS_IMPORT_LOCAL=1
~/.cline/data/settings/providers.json, if CLINE_PASS_IMPORT_LOCAL=1
saved OMP/Pi /login credential
```

`/login` uses the same Cline account device authorization flow as the Cline CLI, then stores the resulting provider credentials in OMP/Pi. Set `CLINE_PASS_LOGIN_MODE=api-key` only if you want to skip browser sign-in and paste an API key directly.

## Commands

```text
/clinepass doctor
/clinepass models
/clinepass verify
```

`doctor` checks whether usable auth or local Cline settings are visible. `verify` sends one tiny direct chat-completion request to Cline's API.

Useful options:

```text
--model <id>      Verification model, default glm-5.2
--base-url <url>  Cline API base URL override
--json            Return JSON
```

## Safety

The extension never prints Cline access or refresh tokens in command output. `/login` stores only the Cline account or API-key credential returned through OMP/Pi; local Cline provider tokens are not copied unless you explicitly set `CLINE_PASS_IMPORT_LOCAL=1`.
