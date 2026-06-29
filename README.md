# Cline Pass Extension

Pi and OMP extension for using Cline Pass through CLIProxyAPI.

This does not implement a separate Cline login. Sign in with Cline first, then use this extension to point CLIProxyAPI at Cline's existing `providers.json`.

## Install

```bash
omp plugin install github:rabesss/cline-pass-extension
```

```bash
pi install git:github.com/rabesss/cline-pass-extension
```

For local development:

```bash
omp -e /path/to/cline-pass-extension
pi -e /path/to/cline-pass-extension
```

## Commands

```text
/clinepass doctor
/clinepass install
/clinepass install --mode copy
/clinepass uninstall
/clinepass verify
```

`install` creates `~/.cli-proxy-api/cline-providers.json` as a symlink to Cline's settings by default. Use `--mode copy` only when a symlink will not work, such as inside a container or service boundary.

Useful options:

```text
--source <path>       Cline providers.json path
--auth-dir <path>     CLIProxyAPI auth directory
--target-name <name>  Target filename, default cline-providers.json
--base-url <url>      CLIProxyAPI URL, default http://127.0.0.1:8317
--model <id>          Verify model, default cline-pass/glm-5.2
--force              Replace/remove non-managed target
--dry-run            Show actions without writing
--json               Return JSON
```

## Provider

The extension registers a `cline-pass` provider pointed at CLIProxyAPI's OpenAI-compatible API. Set these environment variables when needed:

```bash
export CLIPROXY_BASE_URL=http://127.0.0.1:8317
export CLIPROXY_API_KEY=...
```

Models use the same wire IDs as CLIProxyAPI, for example `cline-pass/glm-5.2` and `cline-pass/kimi-k2.7-code`.

## Safety

The extension never prints Cline access or refresh tokens. `doctor` and `verify` report status only. The default install mode is a symlink so token refreshes stay owned by Cline.
