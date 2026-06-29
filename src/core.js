import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_MODEL = "cline-pass/glm-5.2";
export const DEFAULT_PROXY_BASE_URL = "http://127.0.0.1:8317";
export const DEFAULT_AUTH_DIR = "~/.cli-proxy-api";
export const DEFAULT_TARGET_NAME = "cline-providers.json";
export const DEFAULT_SOURCE_PATH = "~/.cline/data/settings/providers.json";

export const CLINE_PASS_MODELS = [
  ["cline-pass/glm-5.2", "GLM 5.2"],
  ["cline-pass/kimi-k2.7-code", "Kimi K2.7 Code"],
  ["cline-pass/kimi-k2.6", "Kimi K2.6"],
  ["cline-pass/deepseek-v4-pro", "DeepSeek V4 Pro"],
  ["cline-pass/deepseek-v4-flash", "DeepSeek V4 Flash"],
  ["cline-pass/mimo-v2.5", "MiMo V2.5"],
  ["cline-pass/mimo-v2.5-pro", "MiMo V2.5 Pro"],
  ["cline-pass/minimax-m3", "MiniMax M3"],
  ["cline-pass/qwen3.7-max", "Qwen3.7 Max"],
  ["cline-pass/qwen3.7-plus", "Qwen3.7 Plus"],
].map(([id, name]) => ({
  id,
  name,
  reasoning: true,
  input: ["text"],
  supportsTools: true,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 16384,
}));

export function buildProviderConfig(env = process.env) {
  return {
    baseUrl: normalizeOpenAIBaseUrl(env.CLIPROXY_BASE_URL || DEFAULT_PROXY_BASE_URL),
    apiKey: env.CLIPROXY_API_KEY || "CLIPROXY_API_KEY",
    authHeader: true,
    api: "openai-completions",
    models: CLINE_PASS_MODELS,
  };
}

export function commandUsage() {
  return [
    "Usage: /clinepass <doctor|install|uninstall|verify> [options]",
    "",
    "Options:",
    "  --source <path>       Cline providers.json path",
    "  --auth-dir <path>     CLIProxyAPI auth directory",
    "  --target-name <name>  Linked/copied auth filename",
    "  --mode <symlink|copy> Install mode, default symlink",
    "  --base-url <url>      CLIProxyAPI base URL",
    "  --model <id>          Verification model",
    "  --force              Overwrite/remove non-managed target",
    "  --dry-run            Show install/uninstall actions only",
    "  --json               Return JSON",
  ].join("\n");
}

export function expandHome(input, env = process.env) {
  if (!input) return input;
  if (input === "~") return env.HOME || os.homedir();
  if (input.startsWith("~/")) return path.join(env.HOME || os.homedir(), input.slice(2));
  return input;
}

export function normalizeOpenAIBaseUrl(url) {
  const trimmed = String(url || DEFAULT_PROXY_BASE_URL).replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

export function normalizeProxyRoot(url) {
  const trimmed = String(url || DEFAULT_PROXY_BASE_URL).replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
}

export async function resolvePaths(options = {}, env = process.env) {
  const source = path.resolve(expandHome(resolveSourcePath(options, env), env));
  const authDir = path.resolve(expandHome(await resolveAuthDir(options, env), env));
  const targetName = options.targetName || DEFAULT_TARGET_NAME;
  if (path.isAbsolute(targetName) || targetName.includes("/") || targetName.includes(path.sep)) {
    throw new Error("--target-name must be a filename, not a path");
  }
  return {
    source,
    authDir,
    targetName,
    target: path.join(authDir, targetName),
    baseUrl: options.baseUrl || env.CLIPROXY_BASE_URL || DEFAULT_PROXY_BASE_URL,
    model: options.model || env.CLINEPASS_MODEL || DEFAULT_MODEL,
  };
}

function resolveSourcePath(options, env) {
  if (options.source) return options.source;
  if (env.CLINE_PROVIDERS_JSON) return env.CLINE_PROVIDERS_JSON;
  if (env.CLINE_DATA_DIR) return path.join(env.CLINE_DATA_DIR, "settings", "providers.json");
  return DEFAULT_SOURCE_PATH;
}

async function resolveAuthDir(options, env) {
  if (options.authDir) return options.authDir;
  const configAuthDir = await readAuthDirFromConfig(env.CLIPROXY_CONFIG, env);
  if (configAuthDir) return configAuthDir;
  if (env.CLIPROXY_AUTH_DIR) return env.CLIPROXY_AUTH_DIR;
  return DEFAULT_AUTH_DIR;
}

export async function readAuthDirFromConfig(configPath, env = process.env) {
  if (!configPath) return undefined;
  const resolvedPath = path.resolve(expandHome(configPath, env));
  let text;
  try {
    text = await fs.readFile(resolvedPath, "utf8");
  } catch {
    return undefined;
  }

  try {
    const parsed = JSON.parse(text);
    const value = parsed?.["auth-dir"] || parsed?.auth_dir;
    if (typeof value === "string" && value.trim()) return value.trim();
  } catch {
    // CLIProxyAPI normally uses YAML; fall through to a narrow YAML parser.
  }

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(auth-dir|auth_dir)\s*:\s*(.+?)\s*$/);
    if (!match) continue;
    const value = stripInlineComment(match[2]).trim();
    if (value) return unquote(value);
  }
  return undefined;
}

function stripInlineComment(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("\"") || trimmed.startsWith("'")) return trimmed;
  const hashIndex = trimmed.indexOf("#");
  return hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export async function inspectClineSettings(source) {
  let raw;
  try {
    raw = await fs.readFile(source, "utf8");
  } catch (error) {
    return {
      ok: false,
      exists: false,
      parseable: false,
      providerPresent: false,
      error: safeErrorMessage(error),
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      exists: true,
      parseable: false,
      providerPresent: false,
      error: safeErrorMessage(error),
    };
  }

  const provider = findClinePassProvider(parsed);
  return {
    ok: Boolean(provider?.present && provider.hasAccessToken),
    exists: true,
    parseable: true,
    providerPresent: Boolean(provider?.present),
    hasAccessToken: Boolean(provider?.hasAccessToken),
    hasRefreshToken: Boolean(provider?.hasRefreshToken),
    hasExpiry: Boolean(provider?.hasExpiry),
  };
}

function findClinePassProvider(parsed) {
  const providers = parsed?.providers;
  if (!providers || typeof providers !== "object") return { present: false };

  for (const [key, value] of Object.entries(providers)) {
    const settings = value?.settings || value;
    if (key !== "cline-pass" && settings?.provider !== "cline-pass") continue;
    const auth = settings?.auth || value?.auth || {};
    return {
      present: true,
      hasAccessToken: typeof auth.accessToken === "string" && auth.accessToken.length > 0,
      hasRefreshToken: typeof auth.refreshToken === "string" && auth.refreshToken.length > 0,
      hasExpiry: auth.expiresAt !== undefined || auth.expiry !== undefined || auth.expires_at !== undefined,
    };
  }
  return { present: false };
}

export async function doctorClinePass(options = {}, env = process.env) {
  const paths = await resolvePaths(options, env);
  const source = await inspectClineSettings(paths.source);
  const authDir = await inspectAuthDir(paths.authDir);
  const target = await inspectTarget(paths.target, paths.source);

  const checks = [
    {
      name: "Cline providers.json",
      ok: source.exists && source.parseable,
      detail: source.exists ? paths.source : `${paths.source} not found`,
    },
    {
      name: "Cline Pass login",
      ok: source.providerPresent && source.hasAccessToken,
      detail: source.providerPresent
        ? source.hasAccessToken
          ? "provider present with an access token"
          : "provider present but no access token"
        : "cline-pass provider not found",
    },
    {
      name: "CLIProxyAPI auth dir",
      ok: authDir.ok,
      detail: authDir.detail,
    },
    {
      name: "CLIProxyAPI target",
      ok: target.managed,
      detail: target.detail,
    },
  ];

  return {
    ok: checks.every(check => check.ok),
    command: "doctor",
    paths,
    checks,
  };
}

async function inspectAuthDir(authDir) {
  try {
    const stat = await fs.stat(authDir);
    if (!stat.isDirectory()) return { ok: false, detail: `${authDir} exists but is not a directory` };
    return { ok: true, detail: authDir };
  } catch {
    return { ok: false, detail: `${authDir} not found` };
  }
}

async function inspectTarget(target, source) {
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch {
    return { exists: false, managed: false, detail: `${target} not installed` };
  }

  if (stat.isSymbolicLink()) {
    const rawTarget = await fs.readlink(target);
    const pointsToSource = await symlinkPointsTo(target, rawTarget, source);
    return {
      exists: true,
      managed: pointsToSource,
      detail: pointsToSource ? `${target} links to Cline settings` : `${target} links elsewhere`,
    };
  }

  if (stat.isFile()) {
    const matches = await sameFileBytes(target, source);
    return {
      exists: true,
      managed: matches,
      detail: matches ? `${target} is a matching copy` : `${target} exists and differs`,
    };
  }

  return { exists: true, managed: false, detail: `${target} exists and is not a file` };
}

export async function installClinePass(options = {}, env = process.env) {
  const paths = await resolvePaths(options, env);
  const mode = options.mode || "symlink";
  if (!["symlink", "copy"].includes(mode)) throw new Error("--mode must be symlink or copy");

  const source = await inspectClineSettings(paths.source);
  if (!source.exists || !source.parseable) throw new Error(`Cline providers.json is not readable: ${paths.source}`);
  if (!source.providerPresent) throw new Error("Cline providers.json does not contain a cline-pass provider");
  if (!source.hasAccessToken) throw new Error("Cline Pass provider is present but does not have an access token");

  const current = await inspectTarget(paths.target, paths.source);
  const action = current.exists ? "replace" : "create";
  if (options.dryRun) {
    return { ok: true, command: "install", dryRun: true, mode, action, paths };
  }

  await fs.mkdir(paths.authDir, { recursive: true, mode: 0o700 });
  await removeExistingTarget(paths.target, paths.source, {
    force: Boolean(options.force),
    allowManaged: true,
  });

  if (mode === "copy") {
    await fs.copyFile(paths.source, paths.target);
    await fs.chmod(paths.target, 0o600);
  } else {
    await fs.symlink(paths.source, paths.target);
  }

  return { ok: true, command: "install", dryRun: false, mode, action, paths };
}

export async function uninstallClinePass(options = {}, env = process.env) {
  const paths = await resolvePaths(options, env);
  const current = await inspectTarget(paths.target, paths.source);
  if (!current.exists) {
    return { ok: true, command: "uninstall", dryRun: Boolean(options.dryRun), action: "noop", paths };
  }
  if (options.dryRun) {
    return { ok: true, command: "uninstall", dryRun: true, action: "remove", paths };
  }

  await removeExistingTarget(paths.target, paths.source, {
    force: Boolean(options.force),
    allowManaged: true,
  });

  return { ok: true, command: "uninstall", dryRun: false, action: "remove", paths };
}

async function removeExistingTarget(target, source, options) {
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch {
    return;
  }

  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    throw new Error(`${target} is a directory; refusing to remove it`);
  }

  if (stat.isSymbolicLink()) {
    const rawTarget = await fs.readlink(target);
    const managed = await symlinkPointsTo(target, rawTarget, source);
    if (!managed && !options.force) {
      throw new Error(`${target} links elsewhere; rerun with --force to replace it`);
    }
    await fs.unlink(target);
    return;
  }

  if (stat.isFile()) {
    const matches = await sameFileBytes(target, source);
    if (!matches && !options.force) {
      throw new Error(`${target} exists and differs; rerun with --force to replace it`);
    }
    await fs.unlink(target);
    return;
  }

  if (!options.force) throw new Error(`${target} exists and is not a managed file`);
  await fs.rm(target, { force: true });
}

async function symlinkPointsTo(linkPath, rawTarget, source) {
  const absoluteTarget = path.resolve(path.dirname(linkPath), rawTarget);
  const absoluteSource = path.resolve(source);
  if (absoluteTarget === absoluteSource) return true;
  return sameRealPath(absoluteTarget, absoluteSource);
}

async function sameRealPath(left, right) {
  try {
    const [resolvedLeft, resolvedRight] = await Promise.all([fs.realpath(left), fs.realpath(right)]);
    return resolvedLeft === resolvedRight;
  } catch {
    return false;
  }
}

async function sameFileBytes(left, right) {
  try {
    const [leftBytes, rightBytes] = await Promise.all([fs.readFile(left), fs.readFile(right)]);
    return Buffer.compare(leftBytes, rightBytes) === 0;
  } catch {
    return false;
  }
}

export async function verifyClinePass(options = {}, env = process.env) {
  const paths = await resolvePaths(options, env);
  const root = normalizeProxyRoot(paths.baseUrl);
  const apiKey = env.CLIPROXY_API_KEY || "";
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

  if (typeof fetch !== "function") {
    throw new Error("global fetch is not available; use Node 18+ or a runtime with fetch");
  }

  const modelsResponse = await fetch(`${root}/v1/models`, { headers });
  if (!modelsResponse.ok) {
    return {
      ok: false,
      command: "verify",
      stage: "models",
      status: modelsResponse.status,
      detail: "CLIProxyAPI /v1/models did not return OK",
      paths,
    };
  }
  const modelsPayload = await modelsResponse.json();
  const models = Array.isArray(modelsPayload?.data) ? modelsPayload.data : [];
  const modelPresent = models.some(model => model?.id === paths.model);
  if (!modelPresent) {
    return {
      ok: false,
      command: "verify",
      stage: "models",
      detail: `${paths.model} was not listed by CLIProxyAPI`,
      paths,
    };
  }

  const sentinel = "CPA_CLINEPASS_EXTENSION_OK";
  const chatResponse = await fetch(`${root}/v1/chat/completions`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: paths.model,
      messages: [{ role: "user", content: `Reply with exactly: ${sentinel}` }],
      temperature: 0,
      max_tokens: 32,
    }),
  });

  if (!chatResponse.ok) {
    return {
      ok: false,
      command: "verify",
      stage: "chat",
      status: chatResponse.status,
      detail: "CLIProxyAPI /v1/chat/completions did not return OK",
      paths,
    };
  }

  const chatPayload = await chatResponse.json();
  const content = chatPayload?.choices?.[0]?.message?.content;
  return {
    ok: typeof content === "string" && content.includes(sentinel),
    command: "verify",
    stage: "chat",
    detail:
      typeof content === "string" && content.includes(sentinel)
        ? "model returned the verification sentinel"
        : "model responded, but not with the verification sentinel",
    paths,
  };
}

export function parseCommandArgs(args) {
  const tokens = tokenize(args || "");
  const command = tokens.shift() || "help";
  const options = {};

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);

    const eqIndex = token.indexOf("=");
    const rawKey = eqIndex >= 0 ? token.slice(2, eqIndex) : token.slice(2);
    const key = camelCase(rawKey);
    const inlineValue = eqIndex >= 0 ? token.slice(eqIndex + 1) : undefined;

    if (["force", "dryRun", "json"].includes(key)) {
      options[key] = inlineValue === undefined ? true : parseBoolean(inlineValue, rawKey);
      continue;
    }

    const value = inlineValue ?? tokens[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${rawKey}`);
    options[key] = value;
  }

  return { command, options };
}

function tokenize(args) {
  const tokens = [];
  let current = "";
  let quote = "";
  let escaping = false;

  for (const char of args) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      else current += char;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaping) current += "\\";
  if (quote) throw new Error("Unclosed quote in arguments");
  if (current) tokens.push(current);
  return tokens;
}

function camelCase(value) {
  return value.replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
}

function parseBoolean(value, key) {
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(`Invalid boolean for --${key}: ${value}`);
}

export async function runClinePassCommand(args, env = process.env) {
  const { command, options } = parseCommandArgs(args);
  let result;
  switch (command) {
    case "doctor":
      result = await doctorClinePass(options, env);
      break;
    case "install":
      result = await installClinePass(options, env);
      break;
    case "uninstall":
      result = await uninstallClinePass(options, env);
      break;
    case "verify":
      result = await verifyClinePass(options, env);
      break;
    case "help":
      result = { ok: true, command: "help", detail: commandUsage() };
      break;
    default:
      throw new Error(`Unknown clinepass command: ${command}`);
  }
  return { ...result, json: Boolean(options.json) };
}

export function formatCommandResult(result, json = false) {
  if (json || result.json) {
    return JSON.stringify(toSafeResult(result), null, 2);
  }
  if (result.command === "help") return result.detail;
  if (result.command === "doctor") {
    return result.checks.map(check => `${check.ok ? "OK" : "FAIL"} ${check.name}: ${check.detail}`).join("\n");
  }
  const status = result.ok ? "OK" : "FAIL";
  const details = [result.detail, result.mode && `mode=${result.mode}`, result.action && `action=${result.action}`]
    .filter(Boolean)
    .join(" ");
  return `${status} clinepass ${result.command}${result.dryRun ? " dry-run" : ""}${details ? `: ${details}` : ""}`;
}

function toSafeResult(result) {
  return JSON.parse(
    JSON.stringify(result, (key, value) => {
      if (/token|secret|apikey|authorization/i.test(key)) return value ? "[redacted]" : value;
      return value;
    }),
  );
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function providerModelSelectors() {
  return CLINE_PASS_MODELS.map(model => model.id);
}
