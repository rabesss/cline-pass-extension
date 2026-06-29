# Cline Pass Provider

Dependency-free Pi and OMP provider extension for Cline Pass.

This package talks directly to Cline's OpenAI-compatible API. It does not use CLIProxyAPI.

For reliable auth, create a Cline API key and run OMP/Pi `/login` for `Cline Pass`, or set `CLINE_PASS_API_KEY`. Existing Cline local auth can be inspected with `/clinepass doctor`; local Cline account-token reuse is disabled by default and can be tried with `CLINE_PASS_IMPORT_LOCAL=1`.

## Install

```bash
omp plugin install github:rabesss/cline-pass-extension#v0.2.1
```

```bash
pi install git:github.com/rabesss/cline-pass-extension@v0.2.1
```

For local development:

```bash
omp -e /path/to/cline-pass-extension
pi -e /path/to/cline-pass-extension
```

To make the provider appear in OMP `/login`, install or link the plugin first:

```bash
omp plugin install github:rabesss/cline-pass-extension#v0.2.1
# or, from this checkout:
omp plugin link .
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
CLINE_PROVIDERS_JSON
CLINE_DATA_DIR/settings/providers.json
~/.cline/data/settings/providers.json
```

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

The extension never prints Cline access or refresh tokens in command output. `/login` stores only the credential you provide to OMP/Pi; local Cline provider tokens are not copied unless you explicitly set `CLINE_PASS_IMPORT_LOCAL=1`.
