import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const PROVIDER_ID = "cline-pass";
export const CLINE_ACCOUNT_PROVIDER_ID = "cline";
export const PROVIDER_NAME = "Cline Pass";
export const CLINE_API_BASE = "https://api.cline.bot/api/v1";
export const CLINE_WORKOS_API_BASE = "https://api.workos.com";
export const CLINE_WORKOS_CLIENT_ID = "client_01K3A541FN8TA3EPPHTD2325AR";
export const CLINE_WORKOS_ACCESS_TOKEN_PREFIX = "workos:";
export const CLINE_PASS_API_KEY_ENV_VAR = "CLINE_PASS_API_KEY";
export const CLINE_API_KEY_ENV_VAR = "CLINE_API_KEY";
export const CLINE_PASS_ACCESS_TOKEN_ENV_VAR = "CLINE_PASS_ACCESS_TOKEN";
export const CLINE_PASS_OMP_AGENT_DB_ENV_VAR = "CLINE_PASS_OMP_AGENT_DB";
export const DEFAULT_MODEL = "glm-5.2";
export const DEFAULT_WIRE_MODEL = "cline-pass/glm-5.2";
export const DEFAULT_SOURCE_PATH = "~/.cline/data/settings/providers.json";
export const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

type Env = Record<string, string | undefined>;
type JsonRecord = Record<string, any>;

type FetchLike = (url: string, init?: RequestInit) => Promise<ResponseLike>;

interface HeadersLike {
  forEach(callback: (value: string, key: string) => void): void;
}

interface ResponseLike {
  ok: boolean;
  status: number;
  headers?: HeadersLike;
  body?: ReadableStream<Uint8Array> | null;
  json(): Promise<any>;
}

interface Cost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ClinePassModel {
  id: string;
  wireId: string;
  name: string;
  reasoning: boolean;
  input: string[];
  cost: Cost;
  contextWindow: number;
  maxTokens: number;
}

interface OAuthAdapter {
  name: string;
  login(callbacks?: LoginCallbacks): Promise<Credentials>;
  refreshToken(credentials: Credentials, options?: RefreshCredentialsOptions): Promise<Credentials>;
  getApiKey(credentials?: Partial<Credentials>): string;
}

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey?: string;
  authHeader: boolean;
  api: string;
  streamSimple: StreamFunction;
  oauth: OAuthAdapter;
  models: ClinePassModel[];
}

interface BuildProviderOptions {
  baseUrl?: string;
  apiKey?: string;
  streamSimple?: StreamFunction;
  oauth?: OAuthAdapter;
  apiBase?: string;
  fetchImpl?: FetchLike;
  createStream?: () => ClinePassEventSink;
  now?: () => number;
}

interface Credentials {
  access: string;
  refresh: string;
  expires: number;
}

interface LoginCallbacks {
  onAuth?: (info: { url: string; instructions: string }) => void | Promise<void>;
  onPrompt?: (prompt: { message: string }) => string | Promise<string>;
  onProgress?: (message: string) => void | Promise<void>;
  fetch?: FetchLike;
  signal?: AbortSignal;
}

interface ReadCredentialsOptions {
  env?: Env;
  path?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  persist?: boolean;
  refreshSkewMs?: number;
}

interface RefreshCredentialsOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

interface RefreshAuthOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

interface RefreshAuthResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: unknown;
  accountId?: string;
}

interface ParseClineAuthPayloadOptions {
  requireRefreshToken?: boolean;
}

interface ClineDeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresInSeconds: number;
  pollIntervalSeconds: number;
}

interface WorkosTokenResult {
  accessToken: string;
  refreshToken: string;
  tokenType?: string;
}

interface ClineProviderAuth {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: unknown;
  accountId?: string;
  [key: string]: unknown;
}

interface ClineProviderSettings {
  provider?: string;
  model?: string;
  auth?: ClineProviderAuth;
  [key: string]: unknown;
}

interface ClineProviderEntry {
  settings?: ClineProviderSettings;
  auth?: ClineProviderAuth;
  [key: string]: unknown;
}

interface ClineSettings {
  providers?: Record<string, ClineProviderEntry>;
  [key: string]: unknown;
}

interface FoundClineProvider {
  key: string;
  entry: ClineProviderEntry;
  settings: ClineProviderSettings;
  auth: ClineProviderAuth | undefined;
}

interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

interface DoctorResult {
  ok: boolean;
  command: "doctor";
  providersPath: string;
  checks: DoctorCheck[];
  json?: boolean;
}

interface VerifyOptions {
  model?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  json?: boolean;
}

interface VerifyResult {
  ok: boolean;
  command: "verify";
  status: number;
  detail: string;
  model: string;
  baseUrl: string;
  json?: boolean;
}

interface ModelsResult {
  ok: boolean;
  command: "models";
  models: string[];
  json?: boolean;
}

interface HelpResult {
  ok: boolean;
  command: "help";
  detail: string;
  json?: boolean;
}

type CommandResult = DoctorResult | VerifyResult | ModelsResult | HelpResult;

interface CommandOptions extends VerifyOptions {
  json?: boolean;
}

interface ParsedCommand {
  command: string;
  options: CommandOptions;
}

interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: Cost & { total: number };
}

interface RuntimeModel {
  api?: string;
  provider?: string;
  id?: string;
  maxTokens?: number;
  cost?: Cost;
}

interface RuntimeMessage {
  role?: string;
  content?: unknown;
  toolCallId?: string;
}

interface RuntimeTool {
  name: string;
  description?: string;
  parameters?: JsonRecord;
}

interface StreamContext {
  systemPrompt?: string | string[];
  messages?: RuntimeMessage[];
  tools?: RuntimeTool[];
}

interface StreamOptions {
  apiKey?: string;
  maxTokens?: number;
  toolChoice?: unknown;
  signal?: AbortSignal;
  onPayload?: (payload: JsonRecord, model?: RuntimeModel) => void | Promise<void>;
  onResponse?: (response: { status: number; headers: Record<string, string> }, model?: RuntimeModel) => void | Promise<void>;
}

interface RuntimeApiKeyOptions extends StreamOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

interface OutputMessage {
  role: "assistant";
  content: JsonRecord[];
  api?: string | undefined;
  provider: string;
  model: string;
  usage: Usage;
  stopReason: string;
  timestamp: number;
  errorMessage?: string;
}

interface StreamConsumeResult {
  finishReason?: unknown;
  toolUse: boolean;
}

interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface StreamEvent {
  type: string;
  [key: string]: unknown;
}

interface ClinePassEventSink extends AsyncIterable<StreamEvent> {
  push(event: StreamEvent): void;
  end(): void;
}

type StreamFunction = (
  model?: RuntimeModel,
  context?: StreamContext,
  options?: StreamOptions,
) => AsyncIterable<StreamEvent>;

export const CLINE_PASS_MODELS: ClinePassModel[] = ([
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
] as const).map(([wireId, name]) => ({
  id: fromWireModelId(wireId),
  wireId,
  name,
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 16384,
}));

export function buildProviderConfig(options: BuildProviderOptions = {}): ProviderConfig {
  const config: ProviderConfig = {
    name: PROVIDER_NAME,
    baseUrl: options.baseUrl || process.env.CLINE_PASS_API_BASE || CLINE_API_BASE,
    authHeader: true,
    api: "cline-pass-custom",
    streamSimple: options.streamSimple || createStreamClinePass(options),
    oauth: options.oauth || {
      name: PROVIDER_NAME,
      login: loginClinePass,
      refreshToken: refreshClinePassCredentials,
      getApiKey: getClinePassApiKey,
    },
    models: CLINE_PASS_MODELS,
  };
  const apiKey = stringValue(options.apiKey);
  if (apiKey) config.apiKey = apiKey;
  return config;
}

export function expandHome(input: string, env: Env = process.env): string {
  if (!input) return input;
  if (input === "~") return env.HOME || os.homedir();
  if (input.startsWith("~/")) return path.join(env.HOME || os.homedir(), input.slice(2));
  return input;
}

export function resolveProvidersPath(env: Env = process.env): string {
  if (env.CLINE_PROVIDERS_JSON) return path.resolve(expandHome(env.CLINE_PROVIDERS_JSON, env));
  if (env.CLINE_DATA_DIR) return path.resolve(expandHome(path.join(env.CLINE_DATA_DIR, "settings", "providers.json"), env));
  return path.resolve(expandHome(DEFAULT_SOURCE_PATH, env));
}

export async function readClinePassAccessToken(options: ReadCredentialsOptions = {}): Promise<string> {
  const credentials = await readClinePassCredentials(options);
  return credentials.access;
}

export async function readClinePassCredentials(options: ReadCredentialsOptions = {}): Promise<Credentials> {
  const env = options.env || process.env;
  const envApiKey = stringValue(env.CLINE_PASS_API_KEY) || stringValue(env.CLINE_API_KEY);
  if (envApiKey) return credentialsFromApiKey(envApiKey);

  const envToken = stringValue(env.CLINE_PASS_ACCESS_TOKEN);
  if (envToken) return credentialsFromAuth({ accessToken: envToken });

  const providersPath = options.path || resolveProvidersPath(env);
  const settings = await readProviderSettings(providersPath);
  const provider = findClineAuthProviderEntry(settings);
  const token = stringValue(provider?.auth?.accessToken);
  if (!provider || !token) throw new Error("Cline access token not found. Sign in with Cline first.");
  if (!isClineAccountAuthExpired(provider.auth, token, options.refreshSkewMs ?? 60_000)) {
    return credentialsFromAuth(provider.auth, token);
  }

  const refreshToken = stringValue(provider?.auth?.refreshToken);
  if (!refreshToken) throw new Error("Cline Pass access token is expired and no refresh token is available.");

  const refreshed = await refreshClinePassAuth(refreshToken, {
    baseUrl: options.baseUrl || env.CLINE_PASS_API_BASE || CLINE_API_BASE,
    fetchImpl: options.fetchImpl || fetch,
  });
  if (options.persist !== false) {
    await updateStoredClinePassAuth(providersPath, refreshToken, refreshed);
  }
  const refreshedAuth: ClineProviderAuth = {
    ...provider.auth,
    accessToken: formatClineAccountAccessToken(refreshed.accessToken),
    refreshToken: refreshed.refreshToken || refreshToken,
    expiresAt: refreshed.expiresAt,
  };
  const accountId = refreshed.accountId || provider.auth?.accountId;
  if (accountId) refreshedAuth.accountId = accountId;
  return credentialsFromAuth(refreshedAuth);
}

export async function refreshClinePassAuth(refreshToken: string | undefined, options: RefreshAuthOptions = {}): Promise<RefreshAuthResult> {
  if (!stringValue(refreshToken)) throw new Error("Cline Pass refresh token is missing.");
  const fetchImpl = options.fetchImpl || fetch;
  if (typeof fetchImpl !== "function") throw new Error("global fetch is not available; use Node 18+ or a runtime with fetch");

  const baseUrl = (options.baseUrl || CLINE_API_BASE).replace(/\/+$/, "");
  const response = await fetchImpl(`${baseUrl}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grantType: "refresh_token",
      refreshToken,
    }),
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok || payload?.success === false) {
    const detail = safeRefreshErrorDetail(payload, response.status);
    throw new Error(`Cline Pass token refresh failed: ${detail}`);
  }
  return parseClineAuthPayload(payload, "Cline Pass token refresh response");
}

export async function loginClinePass(callbacks: LoginCallbacks = {}): Promise<Credentials> {
  const envApiKey = stringValue(process.env.CLINE_PASS_API_KEY) || stringValue(process.env.CLINE_API_KEY);
  if (envApiKey) return credentialsFromApiKey(envApiKey);

  if (process.env.CLINE_PASS_IMPORT_LOCAL === "1") {
    return readClinePassCredentials();
  }

  if (process.env.CLINE_PASS_LOGIN_MODE !== "api-key" && typeof callbacks.onAuth === "function") {
    try {
      return await loginClineAccount(callbacks);
    } catch (error) {
      if (typeof callbacks.onPrompt !== "function") throw error;
      await callbacks.onProgress?.(`Cline account login failed: ${sanitizeErrorDetail(safeError(error))}`);
    }
  }

  await callbacks.onAuth?.({
    url: "https://app.cline.bot/settings/api-keys",
    instructions: "Create a Cline API key, then paste it into the prompt.",
  });
  if (typeof callbacks.onPrompt !== "function") {
    throw new Error("Run /login in OMP to sign in with Cline, or set CLINE_PASS_API_KEY.");
  }
  const apiKey = sanitizeCredentialInput(
    await callbacks.onPrompt({ message: "Paste a Cline API key for Cline Pass, or leave blank to cancel:" }),
  );
  if (!apiKey) throw new Error("No Cline API key provided.");
  return credentialsFromApiKey(apiKey);
}

export async function loginClineAccount(callbacks: LoginCallbacks = {}): Promise<Credentials> {
  if (typeof callbacks.onAuth !== "function") {
    throw new Error("Cline account login requires an auth callback.");
  }

  const fetchImpl: FetchLike = callbacks.fetch || (fetch as FetchLike);
  if (typeof fetchImpl !== "function") throw new Error("global fetch is not available; use Node 18+ or a runtime with fetch");

  const apiBaseUrl = (process.env.CLINE_PASS_API_BASE || CLINE_API_BASE).replace(/\/+$/, "");
  const workosApiBaseUrl = (process.env.CLINE_PASS_WORKOS_API_BASE || CLINE_WORKOS_API_BASE).replace(/\/+$/, "");
  const clientId = stringValue(process.env.CLINE_PASS_WORKOS_CLIENT_ID) || CLINE_WORKOS_CLIENT_ID;
  const device = await startClineDeviceAuthorization({ fetchImpl, workosApiBaseUrl, clientId, signal: callbacks.signal });

  await callbacks.onAuth({
    url: device.verificationUriComplete || verificationUriWithCode(device),
    instructions: `Enter this code in your browser: ${device.userCode}`,
  });
  await callbacks.onProgress?.("Waiting for browser authentication confirmation...");

  const workosToken = await pollClineDeviceAuthorization({
    fetchImpl,
    workosApiBaseUrl,
    clientId,
    device,
    signal: callbacks.signal,
    onProgress: callbacks.onProgress,
  });
  const registered = await registerClineAccountToken({
    fetchImpl,
    apiBaseUrl,
    token: workosToken,
    signal: callbacks.signal,
  });
  const auth: ClineProviderAuth = { accessToken: formatClineAccountAccessToken(registered.accessToken) };
  if (registered.refreshToken) auth.refreshToken = registered.refreshToken;
  if (registered.expiresAt !== undefined) auth.expiresAt = registered.expiresAt;
  if (registered.accountId) auth.accountId = registered.accountId;
  return credentialsFromAuth(auth);
}

async function startClineDeviceAuthorization(options: {
  fetchImpl: FetchLike;
  workosApiBaseUrl: string;
  clientId: string;
  signal?: AbortSignal | undefined;
}): Promise<ClineDeviceAuthorization> {
  throwIfAborted(options.signal);
  const response = await options.fetchImpl(`${options.workosApiBaseUrl}/user_management/authorize/device`, withAbortSignal({
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: options.clientId }),
  }, options.signal));
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(`Cline device authorization failed: ${safeOAuthErrorDetail(payload, response.status)}`);
  }

  const deviceCode = stringValue(payload?.device_code);
  const userCode = stringValue(payload?.user_code);
  const verificationUri = stringValue(payload?.verification_uri);
  if (!deviceCode || !userCode || !verificationUri) {
    throw new Error("Cline device authorization response was missing required fields.");
  }

  const result: ClineDeviceAuthorization = {
    deviceCode,
    userCode,
    verificationUri,
    expiresInSeconds: positiveInteger(payload?.expires_in, 300),
    pollIntervalSeconds: positiveInteger(payload?.interval, 5),
  };
  const verificationUriComplete = stringValue(payload?.verification_uri_complete);
  if (verificationUriComplete) result.verificationUriComplete = verificationUriComplete;
  return result;
}

async function pollClineDeviceAuthorization(options: {
  fetchImpl: FetchLike;
  workosApiBaseUrl: string;
  clientId: string;
  device: ClineDeviceAuthorization;
  signal?: AbortSignal | undefined;
  onProgress?: ((message: string) => void | Promise<void>) | undefined;
}): Promise<WorkosTokenResult> {
  const startedAt = Date.now();
  const expiresAt = startedAt + options.device.expiresInSeconds * 1000;
  let pollIntervalMs = Math.max(1, options.device.pollIntervalSeconds) * 1000;
  const overridePollDelay = optionalNonNegativeInteger(process.env.CLINE_PASS_LOGIN_POLL_DELAY_MS);
  if (overridePollDelay !== undefined) pollIntervalMs = overridePollDelay;

  while (Date.now() <= expiresAt) {
    throwIfAborted(options.signal);
    const response = await options.fetchImpl(`${options.workosApiBaseUrl}/user_management/authenticate`, withAbortSignal({
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: options.device.deviceCode,
        client_id: options.clientId,
      }),
    }, options.signal));
    const payload = await response.json().catch(() => undefined);
    if (response.ok) {
      const accessToken = stringValue(payload?.access_token);
      const refreshToken = stringValue(payload?.refresh_token);
      if (!accessToken || !refreshToken) throw new Error("Cline device token response was missing required fields.");
      return {
        accessToken,
        refreshToken,
        tokenType: stringValue(payload?.token_type),
      };
    }

    const errorCode = stringValue(payload?.error);
    if (errorCode === "authorization_pending" || errorCode === "slow_down") {
      if (errorCode === "slow_down" && overridePollDelay === undefined) pollIntervalMs += 1000;
      await options.onProgress?.("Waiting for browser authentication confirmation...");
      await delay(pollIntervalMs, options.signal);
      continue;
    }
    throw new Error(`Cline device token polling failed: ${safeOAuthErrorDetail(payload, response.status)}`);
  }

  throw new Error("Cline device authorization timed out.");
}

async function registerClineAccountToken(options: {
  fetchImpl: FetchLike;
  apiBaseUrl: string;
  token: WorkosTokenResult;
  signal?: AbortSignal | undefined;
}): Promise<RefreshAuthResult> {
  throwIfAborted(options.signal);
  const response = await options.fetchImpl(`${options.apiBaseUrl}/auth/register`, withAbortSignal({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accessToken: options.token.accessToken,
      refreshToken: options.token.refreshToken,
    }),
  }, options.signal));
  const payload = await response.json().catch(() => undefined);
  if (!response.ok || payload?.success === false) {
    throw new Error(`Cline token registration failed: ${safeOAuthErrorDetail(payload, response.status)}`);
  }
  return parseClineAuthPayload(payload, "Cline token registration response", { requireRefreshToken: true });
}

export async function refreshClinePassCredentials(
  credentials: Partial<Credentials> | undefined,
  options: RefreshCredentialsOptions = {},
): Promise<Credentials> {
  const access = stringValue(credentials?.access);
  const refresh = stringValue(credentials?.refresh);
  if (access && refresh === access) return credentialsFromApiKey(access);

  const refreshed = await refreshClinePassAuth(credentials?.refresh, {
    baseUrl: options.baseUrl || process.env.CLINE_PASS_API_BASE || CLINE_API_BASE,
    fetchImpl: options.fetchImpl || fetch,
  });
  const refreshedAuth: ClineProviderAuth = {
    accessToken: formatClineAccountAccessToken(refreshed.accessToken),
    expiresAt: refreshed.expiresAt,
  };
  const refreshToken = refreshed.refreshToken || credentials?.refresh;
  if (refreshToken) refreshedAuth.refreshToken = refreshToken;
  return credentialsFromAuth(refreshedAuth);
}

export function getClinePassApiKey(credentials?: Partial<Credentials>): string {
  return stringValue(credentials?.access);
}

export async function readProviderSettings(providersPath: string): Promise<ClineSettings> {
  let data: string;
  try {
    data = await fs.readFile(providersPath, "utf8");
  } catch (error) {
    throw new Error(`Unable to read Cline providers.json at ${providersPath}: ${safeError(error)}`);
  }

  try {
    return JSON.parse(data) as ClineSettings;
  } catch (error) {
    throw new Error(`Unable to parse Cline providers.json at ${providersPath}: ${safeError(error)}`);
  }
}

export async function writeProviderSettings(providersPath: string, settings: ClineSettings): Promise<void> {
  const tmpPath = `${providersPath}.${process.pid}.${Date.now()}.tmp`;
  const mode = 0o600;
  await fs.writeFile(tmpPath, `${JSON.stringify(settings, null, 2)}\n`, { mode });
  await fs.rename(tmpPath, providersPath);
  await fs.chmod(providersPath, mode);
}

export function findClinePassProvider(settings: ClineSettings): (ClineProviderSettings & { auth?: ClineProviderAuth }) | undefined {
  const provider = findClinePassProviderEntry(settings);
  if (!provider) return undefined;
  const result: ClineProviderSettings & { auth?: ClineProviderAuth } = {
    ...provider.settings,
  };
  if (provider.auth) result.auth = provider.auth;
  return result;
}

function findClinePassProviderEntry(settings?: ClineSettings): FoundClineProvider | undefined {
  return findClineProviderEntry(settings, [PROVIDER_ID]);
}

function findClineAuthProviderEntry(settings?: ClineSettings): FoundClineProvider | undefined {
  return findClineProviderEntry(settings, [CLINE_ACCOUNT_PROVIDER_ID, PROVIDER_ID]);
}

function findClineProviderEntry(settings: ClineSettings | undefined, providerIds: string[]): FoundClineProvider | undefined {
  const providers = settings?.providers;
  if (!providers || typeof providers !== "object") return undefined;
  const normalizedProviderIds = providerIds.map(providerId => providerId.trim().toLowerCase());

  for (const expectedProviderId of normalizedProviderIds) {
    for (const [key, value] of Object.entries(providers)) {
      const entry = value && typeof value === "object" ? value : {};
      const providerSettings = entry.settings && typeof entry.settings === "object" ? entry.settings : entry;
      const providerId = stringValue(providerSettings.provider) || key;
      if (providerId.trim().toLowerCase() !== expectedProviderId) continue;
      const auth = providerSettings.auth && typeof providerSettings.auth === "object"
        ? providerSettings.auth
        : entry.auth && typeof entry.auth === "object"
          ? entry.auth
          : undefined;
      return { key, entry, settings: providerSettings, auth };
    }
  }

  return undefined;
}

export async function doctorClinePass(env: Env = process.env): Promise<DoctorResult> {
  const providersPath = resolveProvidersPath(env);
  const checks: DoctorCheck[] = [];

  const envApiKey = stringValue(env.CLINE_PASS_API_KEY) || stringValue(env.CLINE_API_KEY);
  if (envApiKey) {
    checks.push({ name: "api key", ok: true, detail: env.CLINE_PASS_API_KEY ? "CLINE_PASS_API_KEY is set" : "CLINE_API_KEY is set" });
    return { ok: true, command: "doctor", providersPath, checks };
  }

  const envToken = stringValue(env.CLINE_PASS_ACCESS_TOKEN);
  if (envToken) {
    checks.push({ name: "access token", ok: true, detail: "CLINE_PASS_ACCESS_TOKEN is set" });
    return { ok: true, command: "doctor", providersPath, checks };
  }

  let settings: ClineSettings;
  try {
    settings = await readProviderSettings(providersPath);
    checks.push({ name: "providers.json", ok: true, detail: providersPath });
  } catch (error) {
    checks.push({ name: "providers.json", ok: false, detail: safeError(error) });
    return { ok: false, command: "doctor", providersPath, checks };
  }

  const provider = findClineAuthProviderEntry(settings);
  checks.push({
    name: "provider",
    ok: Boolean(provider),
    detail: provider ? `${provider.settings.provider || provider.key} provider found` : "cline/cline-pass provider not found",
  });

  checks.push({
    name: "access token",
    ok: Boolean(stringValue(provider?.auth?.accessToken)),
    detail: stringValue(provider?.auth?.accessToken) ? "present" : "missing",
  });

  const expiry = describeExpiry(provider?.auth?.expiresAt);
  if (expiry) {
    const hasRefreshToken = Boolean(stringValue(provider?.auth?.refreshToken));
    checks.push({
      name: "expiry",
      ok: !expiry.expired || hasRefreshToken,
      detail: expiry.expired && hasRefreshToken ? "expired; refresh available" : expiry.detail,
    });
  }

  return { ok: checks.every(check => check.ok), command: "doctor", providersPath, checks };
}

export async function verifyClinePass(options: VerifyOptions = {}, env: Env = process.env): Promise<VerifyResult> {
  const fetchImpl = options.fetchImpl || fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("global fetch is not available; use Node 18+ or a runtime with fetch");
  }

  const model = options.model || env.CLINE_PASS_MODEL || DEFAULT_MODEL;
  const baseUrl = options.baseUrl || env.CLINE_PASS_API_BASE || CLINE_API_BASE;
  const token = await resolveRuntimeApiKey({ baseUrl, fetchImpl }, env);
  if (!token) {
    return {
      ok: false,
      command: "verify",
      status: 0,
      detail: missingApiKeyMessage(),
      model,
      baseUrl,
    };
  }
  const sentinel = "CLINE_PASS_EXTENSION_OK";
  const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: toWireModelId(model),
      messages: [{ role: "user", content: `Reply with exactly: ${sentinel}` }],
      stream: false,
      temperature: 0,
      max_tokens: 32,
    }),
  });

  if (!response.ok) {
    return {
      ok: false,
      command: "verify",
      status: response.status,
      detail: response.status === 401
        ? "Cline API returned HTTP 401. Run /login to sign in with Cline or provide a Cline API key."
        : `Cline API returned HTTP ${response.status}`,
      model,
      baseUrl,
    };
  }

  const payload = await response.json().catch(() => undefined);
  if (payload === undefined) {
    return {
      ok: false,
      command: "verify",
      status: response.status,
      detail: "model responded, but the verification response was not valid JSON",
      model,
      baseUrl,
    };
  }
  const content = payload?.choices?.[0]?.message?.content;
  return {
    ok: typeof content === "string" && content.includes(sentinel),
    command: "verify",
    status: response.status,
    detail:
      typeof content === "string" && content.includes(sentinel)
        ? "model returned the verification sentinel"
        : "model responded, but not with the verification sentinel",
    model,
    baseUrl,
  };
}

export function parseCommandArgs(args: string): ParsedCommand {
  const tokens = tokenize(args || "");
  const command = tokens.shift() || "help";
  const options: CommandOptions = {};

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) throw new Error("Missing argument");
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);

    const eqIndex = token.indexOf("=");
    const rawKey = eqIndex >= 0 ? token.slice(2, eqIndex) : token.slice(2);
    const key = camelCase(rawKey) as keyof CommandOptions;
    const inlineValue = eqIndex >= 0 ? token.slice(eqIndex + 1) : undefined;

    if (["json"].includes(key)) {
      options[key] = (inlineValue === undefined ? true : parseBoolean(inlineValue, rawKey)) as never;
      continue;
    }

    const value = inlineValue ?? tokens[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${rawKey}`);
    options[key] = value as never;
  }

  return { command, options };
}

export async function runClinePassCommand(args: string, env: Env = process.env): Promise<CommandResult> {
  const { command, options } = parseCommandArgs(args);
  let result: CommandResult;
  switch (command) {
    case "doctor":
      result = await doctorClinePass(env);
      break;
    case "verify":
      result = await verifyClinePass(options, env);
      break;
    case "models":
      result = {
        ok: true,
        command: "models",
        models: CLINE_PASS_MODELS.map(model => model.id),
      };
      break;
    case "help":
      result = { ok: true, command: "help", detail: commandUsage() };
      break;
    default:
      throw new Error(`Unknown clinepass command: ${command}`);
  }
  return { ...result, json: Boolean(options.json) };
}

export function commandUsage(): string {
  return [
    "Usage: /clinepass <doctor|verify|models> [options]",
    "",
    "Options:",
    "  --model <id>      Verification model",
    "  --base-url <url>  Cline API base URL",
    "  --json            Return JSON",
  ].join("\n");
}

export function formatCommandResult(result: CommandResult, json = false): string {
  if (json || result.json) return JSON.stringify(toSafeResult(result), null, 2);
  if (result.command === "help") return result.detail;
  if (result.command === "doctor") {
    return result.checks.map(check => `${check.ok ? "OK" : "FAIL"} ${check.name}: ${check.detail}`).join("\n");
  }
  if (result.command === "models") return result.models.join("\n");
  const status = result.ok ? "OK" : "FAIL";
  return `${status} clinepass ${result.command}: ${result.detail}`;
}

class ClinePassEventStream implements ClinePassEventSink {
  private queue: StreamEvent[] = [];
  private waiting: Array<{ resolve: (result: IteratorResult<StreamEvent>) => void }> = [];
  private done = false;

  push(event: StreamEvent): void {
    if (this.done) return;
    if (event.type === "done" || event.type === "error") this.done = true;
    const waiter = this.waiting.shift();
    if (waiter) waiter.resolve({ value: event, done: false });
    else this.queue.push(event);
  }

  end(): void {
    this.done = true;
    while (this.waiting.length > 0) this.waiting.shift()?.resolve({ value: undefined, done: true });
  }

  async *[Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
    while (true) {
      const next = this.queue.shift();
      if (next) {
        yield next;
      } else if (this.done) {
        return;
      } else {
        const event = await new Promise<IteratorResult<StreamEvent>>(resolve => this.waiting.push({ resolve }));
        if (event.done) return;
        yield event.value;
      }
    }
  }
}

export function createStreamClinePass(deps: BuildProviderOptions = {}): StreamFunction {
  const apiBase = deps.baseUrl || deps.apiBase || process.env.CLINE_PASS_API_BASE || CLINE_API_BASE;
  const fetchImpl = deps.fetchImpl || fetch;
  const createStream = deps.createStream || (() => new ClinePassEventStream());
  const now = deps.now || (() => Date.now());

  return function streamClinePass(model: RuntimeModel = {}, context: StreamContext = {}, options: StreamOptions = {}): AsyncIterable<StreamEvent> {
    const stream = createStream();

    async function run(): Promise<void> {
      const output: OutputMessage = {
        role: "assistant",
        content: [],
        api: model?.api,
        provider: model?.provider || PROVIDER_ID,
        model: model?.id || DEFAULT_MODEL,
        usage: defaultUsage(),
        stopReason: "stop",
        timestamp: now(),
      };

      try {
        const apiKey = await resolveRuntimeApiKey({ ...options, baseUrl: apiBase, fetchImpl });
        if (!apiKey) {
          throw new Error(missingApiKeyMessage());
        }

        stream.push({ type: "start", partial: output });
        const payload: JsonRecord = {
          model: toWireModelId(model?.id || DEFAULT_MODEL),
          messages: messagesToOpenAI(context),
          stream: true,
          max_tokens: Math.min(options.maxTokens || model?.maxTokens || 16384, model?.maxTokens || 16384),
        };
        const tools = toolsToOpenAI(context?.tools);
        if (tools.length > 0) payload.tools = tools;
        if (options.toolChoice) payload.tool_choice = options.toolChoice;

        if (typeof options.onPayload === "function") await options.onPayload(payload, model);
        const init: RequestInit = {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        };
        if (options.signal) init.signal = options.signal;
        const response = await fetchImpl(`${apiBase.replace(/\/+$/, "")}/chat/completions`, init);
        if (typeof options.onResponse === "function") {
          await options.onResponse({ status: response.status, headers: headersToRecord(response.headers) }, model);
        }

        if (!response.ok) {
          const data = await response.json().catch(() => undefined);
          throw new Error(clineHTTPErrorMessage(response.status, data));
        }

        const result = response.body
          ? await consumeOpenAIStream(response.body, output, stream, model)
          : await consumeOpenAINonStreamingFallback(response, output, stream, model);
        output.stopReason = result.toolUse ? "toolUse" : finishReason(result.finishReason);
        stream.push({ type: "done", reason: output.stopReason, message: output });
      } catch (error) {
        output.stopReason = error instanceof Error && error.name === "AbortError" ? "aborted" : "error";
        output.errorMessage = error instanceof Error ? error.message : String(error);
        stream.push({ type: "error", reason: output.stopReason === "aborted" ? "aborted" : "error", error: output });
      } finally {
        stream.end();
      }
    }

    queueMicrotask(run);
    return stream;
  };
}

async function consumeOpenAIStream(
  body: ReadableStream<Uint8Array>,
  output: OutputMessage,
  stream: ClinePassEventSink,
  model: RuntimeModel,
): Promise<StreamConsumeResult> {
  let textBlock: JsonRecord | undefined;
  let textIndex = -1;
  let finishReason: unknown;
  const toolCalls = new Map<number, PendingToolCall>();

  for await (const payload of readOpenAISsePayloads(body)) {
    if (payload === "[DONE]") break;

    let chunk: JsonRecord;
    try {
      chunk = JSON.parse(payload) as JsonRecord;
    } catch {
      throw new Error("Cline API returned an invalid streaming JSON chunk.");
    }

    if (chunk.usage) applyUsage(output.usage, chunk.usage, model);
    const choice = chunk.choices?.[0] || {};
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta || {};

    const content = stringValue(delta.content);
    if (content) {
      if (!textBlock) {
        textBlock = { type: "text", text: "" };
        textIndex = output.content.length;
        output.content.push(textBlock);
        stream.push({ type: "text_start", contentIndex: textIndex, partial: output });
      }
      textBlock.text = `${stringValue(textBlock.text)}${content}`;
      stream.push({ type: "text_delta", contentIndex: textIndex, delta: content, partial: output });
    }

    const deltaToolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    for (const tool of deltaToolCalls) {
      const index = typeof tool.index === "number" ? tool.index : toolCalls.size;
      const pending = toolCalls.get(index) || { id: "", name: "", arguments: "" };
      const id = stringValue(tool.id);
      const name = stringValue(tool.function?.name);
      if (id) pending.id = id;
      if (name) pending.name = name;
      if (typeof tool.function?.arguments === "string") pending.arguments += tool.function.arguments;
      toolCalls.set(index, pending);
    }
  }

  if (textBlock) {
    stream.push({ type: "text_end", contentIndex: textIndex, content: stringValue(textBlock.text), partial: output });
  }

  emitPendingToolCalls(toolCalls, output, stream);
  return { finishReason, toolUse: toolCalls.size > 0 };
}

async function consumeOpenAINonStreamingFallback(
  response: ResponseLike,
  output: OutputMessage,
  stream: ClinePassEventSink,
  model: RuntimeModel,
): Promise<StreamConsumeResult> {
  const data = await response.json().catch(() => undefined);
  if (!data) throw new Error("Cline API returned a streaming response without a readable body.");

  applyUsage(output.usage, data?.usage, model);
  const message = data?.choices?.[0]?.message || {};
  const content = stringValue(message.content);
  if (content) {
    const textBlock = { type: "text", text: content };
    const index = output.content.length;
    output.content.push(textBlock);
    stream.push({ type: "text_start", contentIndex: index, partial: output });
    stream.push({ type: "text_delta", contentIndex: index, delta: content, partial: output });
    stream.push({ type: "text_end", contentIndex: index, content, partial: output });
  }

  const toolCalls = new Map<number, PendingToolCall>();
  const messageToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const [index, tool] of messageToolCalls.entries()) {
    toolCalls.set(index, {
      id: stringValue(tool.id) || `tool_${output.content.length + index}`,
      name: stringValue(tool.function?.name),
      arguments: stringValue(tool.function?.arguments),
    });
  }
  emitPendingToolCalls(toolCalls, output, stream);

  return { finishReason: data?.choices?.[0]?.finish_reason, toolUse: toolCalls.size > 0 };
}

function emitPendingToolCalls(
  pendingToolCalls: Map<number, PendingToolCall>,
  output: OutputMessage,
  stream: ClinePassEventSink,
): void {
  for (const [, pending] of [...pendingToolCalls.entries()].sort(([left], [right]) => left - right)) {
    const toolCall = {
      type: "toolCall",
      id: pending.id || `tool_${output.content.length}`,
      name: pending.name,
      arguments: parseToolArguments(pending.arguments),
    };
    const index = output.content.length;
    output.content.push(toolCall);
    stream.push({ type: "toolcall_start", contentIndex: index, partial: output });
    stream.push({ type: "toolcall_end", contentIndex: index, toolCall, partial: output });
  }
}

async function* readOpenAISsePayloads(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = consumeSseLines(buffer);
      buffer = parsed.rest;
      yield* parsed.payloads;
    }

    buffer += decoder.decode();
    if (buffer.trim()) yield* consumeSseLines(`${buffer}\n`, true).payloads;
  } finally {
    reader.releaseLock();
  }
}

function consumeSseLines(buffer: string, flush = false): { payloads: string[]; rest: string } {
  const lines = buffer.split(/\r?\n/);
  const rest = flush ? "" : lines.pop() || "";
  const payloads: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (payload) payloads.push(payload);
  }
  return { payloads, rest };
}

function toSafeResult(result: CommandResult): CommandResult {
  return JSON.parse(
    JSON.stringify(result, (key, value) => {
      if (/token|secret|apikey|authorization/i.test(key)) return value ? "[redacted]" : value;
      return value;
    }),
  ) as CommandResult;
}

async function resolveRuntimeApiKey(options: RuntimeApiKeyOptions = {}, env: Env = process.env): Promise<string> {
  const optionKey = stringValue(options.apiKey);
  if (optionKey && !isEnvVarReference(optionKey)) {
    return accessTokenFromRuntimeOption(optionKey) || optionKey;
  }
  const envApiKey = stringValue(env.CLINE_PASS_API_KEY) || stringValue(env.CLINE_API_KEY);
  if (envApiKey) return envApiKey;
  const envAccessToken = stringValue(env.CLINE_PASS_ACCESS_TOKEN);
  if (envAccessToken) return formatClineAccountAccessToken(envAccessToken);
  if (env.CLINE_PASS_IMPORT_LOCAL === "1") {
    const readOptions: ReadCredentialsOptions = {
      env,
      persist: false,
    };
    if (options.baseUrl) readOptions.baseUrl = options.baseUrl;
    if (options.fetchImpl) readOptions.fetchImpl = options.fetchImpl;
    return readClinePassAccessToken(readOptions).catch(() => "");
  }
  const stored = await readOmpSavedClinePassCredentials(env).catch(() => undefined);
  if (stored) {
    if (!isExpired(stored.expires, 60_000)) return stored.access;
    const refreshOptions: RefreshCredentialsOptions = {};
    if (options.baseUrl) refreshOptions.baseUrl = options.baseUrl;
    if (options.fetchImpl) refreshOptions.fetchImpl = options.fetchImpl;
    const refreshed = await refreshClinePassCredentials(stored, refreshOptions).catch(() => undefined);
    if (refreshed?.access) return refreshed.access;
  }
  return "";
}

function missingApiKeyMessage(): string {
  return "No Cline Pass credential. Run /login and sign in with Cline, or set CLINE_PASS_API_KEY. Set CLINE_PASS_IMPORT_LOCAL=1 only if you want to try an existing local Cline account token.";
}

function isEnvVarReference(value: string): boolean {
  return [CLINE_PASS_API_KEY_ENV_VAR, CLINE_API_KEY_ENV_VAR, CLINE_PASS_ACCESS_TOKEN_ENV_VAR].some(
    key => value === key || value === `$${key}` || value === `\${${key}}`,
  );
}

function accessTokenFromRuntimeOption(value: string): string {
  if (!value.startsWith("{")) return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return "";
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
  const record = parsed as JsonRecord;
  const key = stringValue(record.key);
  if (key) return key;
  return credentialsFromStoredOAuthData(record)?.access || "";
}

async function readOmpSavedClinePassCredentials(env: Env = process.env): Promise<Credentials | undefined> {
  for (const dbPath of resolveOmpAgentDbPathCandidates(env)) {
    if (!(await fileExists(dbPath))) continue;
    const raw = await readOmpAuthCredentialData(dbPath);
    const credentials = raw ? credentialsFromStoredOAuthData(raw) : undefined;
    if (credentials?.access) return credentials;
  }
  return undefined;
}

function resolveOmpAgentDbPathCandidates(env: Env = process.env): string[] {
  const explicit = stringValue(env[CLINE_PASS_OMP_AGENT_DB_ENV_VAR]);
  if (explicit) return [path.resolve(expandHome(explicit, env))];

  const candidates = new Set<string>();
  const home = env.HOME || os.homedir();
  const agentDir = stringValue(env.PI_CODING_AGENT_DIR) || stringValue(env.OMP_AGENT_DIR);
  if (agentDir) candidates.add(path.resolve(expandHome(path.join(agentDir, "agent.db"), env)));

  const configDir = stringValue(env.PI_CONFIG_DIR) || ".omp";
  const profile = normalizeOmpProfileName(stringValue(env.OMP_PROFILE) || stringValue(env.PI_PROFILE));
  const xdgDataHome = stringValue(env.XDG_DATA_HOME);
  if (profile) {
    candidates.add(path.join(home, configDir, "profiles", profile, "agent", "agent.db"));
    if (xdgDataHome) candidates.add(path.join(expandHome(xdgDataHome, env), "omp", "profiles", profile, "agent.db"));
  } else if (xdgDataHome) {
    candidates.add(path.join(expandHome(xdgDataHome, env), "omp", "agent.db"));
  }
  candidates.add(path.join(home, configDir, "agent", "agent.db"));

  return [...candidates];
}

function normalizeOmpProfileName(value: string): string {
  if (!value || value === "default") return "";
  return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value) ? value : "";
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs
    .stat(filePath)
    .then(stat => stat.isFile())
    .catch(() => false);
}

const OMP_AUTH_SQL = [
  "SELECT data FROM auth_credentials",
  "WHERE provider = ? AND credential_type = 'oauth' AND disabled_cause IS NULL",
  "ORDER BY updated_at DESC, id DESC LIMIT 1",
].join(" ");

const OMP_AUTH_SQLITE_CLI_SQL = `${OMP_AUTH_SQL.replace("provider = ?", `provider = '${PROVIDER_ID}'`)};`;

async function readOmpAuthCredentialData(dbPath: string): Promise<string> {
  return (await readOmpAuthCredentialDataWithBunSqlite(dbPath)) || readOmpAuthCredentialDataWithSqliteCli(dbPath);
}

interface BunSqliteStatement {
  get(...params: unknown[]): unknown;
}

interface BunSqliteDatabase {
  query(sql: string): BunSqliteStatement;
  close(): void;
}

type BunSqliteDatabaseConstructor = new (dbPath: string, options?: { readonly?: boolean }) => BunSqliteDatabase;

async function readOmpAuthCredentialDataWithBunSqlite(dbPath: string): Promise<string> {
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
    const mod = await dynamicImport("bun:sqlite") as { Database?: BunSqliteDatabaseConstructor };
    if (typeof mod.Database !== "function") return "";
    const db = new mod.Database(dbPath, { readonly: true });
    try {
      const row = db.query(OMP_AUTH_SQL).get(PROVIDER_ID) as { data?: unknown } | undefined;
      return stringValue(row?.data);
    } finally {
      db.close();
    }
  } catch {
    return "";
  }
}

function readOmpAuthCredentialDataWithSqliteCli(dbPath: string): string {
  try {
    const result = spawnSync("sqlite3", ["-batch", "-noheader", "-readonly", dbPath, OMP_AUTH_SQLITE_CLI_SQL], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    if (result.status !== 0 || result.error) return "";
    return stringValue(result.stdout);
  } catch {
    return "";
  }
}

function messagesToOpenAI(context: StreamContext = {}): JsonRecord[] {
  const messages: JsonRecord[] = [];
  const knownToolCallIds = new Set<string>();
  const systemPrompt = Array.isArray(context.systemPrompt) ? context.systemPrompt.join("\n\n") : stringValue(context.systemPrompt);
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });

  for (const message of context.messages || []) {
    const role = ["system", "user", "assistant", "tool"].includes(stringValue(message.role)) ? stringValue(message.role) : "user";
    if (role === "assistant") {
      const assistant: JsonRecord = { role, content: textFromContent(message.content) };
      const toolCalls = assistantToolCalls(message.content);
      const validToolCalls = toolCalls.filter(toolCall => stringValue(toolCall.id));
      for (const toolCall of validToolCalls) knownToolCallIds.add(stringValue(toolCall.id));
      if (validToolCalls.length > 0) assistant.tool_calls = validToolCalls;
      messages.push(assistant);
    } else if (role === "tool") {
      const toolCallId = stringValue(message.toolCallId);
      if (!toolCallId) throw new Error("Tool messages must include a non-empty toolCallId.");
      if (!knownToolCallIds.has(toolCallId)) {
        throw new Error(`Tool message references unknown toolCallId: ${toolCallId}`);
      }
      messages.push({
        role,
        tool_call_id: toolCallId,
        content: textFromContent(message.content),
      });
    } else {
      messages.push({ role, content: textFromContent(message.content) });
    }
  }

  if (messages.length === 0) messages.push({ role: "user", content: "" });
  return messages;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : String(content);
  return content.map(part => {
    if (typeof part === "string") return part;
    if (part?.type === "text") return stringValue(part.text);
    if (part?.type === "thinking") return stringValue(part.thinking);
    return "";
  }).filter(Boolean).join("\n");
}

function assistantToolCalls(content: unknown): JsonRecord[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter(part => part?.type === "toolCall")
    .map(part => ({
      id: stringValue(part.id),
      type: "function",
      function: {
        name: stringValue(part.name),
        arguments: JSON.stringify(part.arguments || {}),
      },
    }));
}

function toolsToOpenAI(tools: RuntimeTool[] = []): JsonRecord[] {
  if (!Array.isArray(tools)) return [];
  return tools.map(tool => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description || "",
      parameters: tool.parameters || {},
    },
  }));
}

function headersToRecord(headers?: HeadersLike): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers || typeof headers.forEach !== "function") return out;
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function parseToolArguments(input: unknown): JsonRecord {
  if (!input) return {};
  if (typeof input === "object") return input as JsonRecord;
  try {
    return JSON.parse(String(input)) as JsonRecord;
  } catch {
    return {};
  }
}

function applyUsage(usage: Usage, source?: JsonRecord, model: RuntimeModel = {}): void {
  usage.input = numberValue(source?.prompt_tokens);
  usage.output = numberValue(source?.completion_tokens);
  usage.totalTokens = numberValue(source?.total_tokens) || usage.input + usage.output;
  if (!model?.cost) return;
  usage.cost.input = (model.cost.input / 1_000_000) * usage.input;
  usage.cost.output = (model.cost.output / 1_000_000) * usage.output;
  usage.cost.total = usage.cost.input + usage.cost.output;
}

function defaultUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function finishReason(reason: unknown): string {
  return reason === "length" ? "length" : "stop";
}

function clineHTTPErrorMessage(status: number, body?: JsonRecord): string {
  if (status === 401) return "Cline API returned HTTP 401. Run /login to sign in with Cline or provide a Cline API key.";
  const detail = stringValue(body?.error) || stringValue(body?.message);
  return detail ? `Cline API returned HTTP ${status}: ${sanitizeErrorDetail(detail)}` : `Cline API returned HTTP ${status}`;
}

async function updateStoredClinePassAuth(
  providersPath: string,
  expectedRefreshToken: string,
  refreshed: RefreshAuthResult,
): Promise<void> {
  const latest = await readProviderSettings(providersPath);
  const provider = findClineAuthProviderEntry(latest);
  if (!provider) return;

  const currentRefreshToken = stringValue(provider.auth?.refreshToken);
  if (currentRefreshToken && currentRefreshToken !== expectedRefreshToken) return;

  const authTarget = provider.auth || {};
  authTarget.accessToken = formatClineAccountAccessToken(refreshed.accessToken);
  authTarget.refreshToken = refreshed.refreshToken || expectedRefreshToken;
  authTarget.expiresAt = refreshed.expiresAt;
  if (refreshed.accountId) authTarget.accountId = refreshed.accountId;

  if (provider.settings.auth && typeof provider.settings.auth === "object") {
    provider.settings.auth = authTarget;
  } else if (provider.entry.auth && typeof provider.entry.auth === "object") {
    provider.entry.auth = authTarget;
  } else {
    provider.settings.auth = authTarget;
  }

  await writeProviderSettings(providersPath, latest);
}

function credentialsFromAuth(auth?: ClineProviderAuth, accessOverride?: string): Credentials {
  const rawAccess = stringValue(accessOverride) || stringValue(auth?.accessToken);
  const access = formatClineAccountAccessToken(rawAccess);
  const refresh = stringValue(auth?.refreshToken) || access;
  return {
    access,
    refresh,
    expires: clineAccountExpiryTimeMs(auth, access) || Date.now() - 1,
  };
}

function credentialsFromStoredOAuthData(data: string | JsonRecord): Credentials | undefined {
  let record: JsonRecord;
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
      record = parsed as JsonRecord;
    } catch {
      return undefined;
    }
  } else {
    record = data;
  }

  const access = stringValue(record.access) || stringValue(record.accessToken);
  if (!access) return undefined;
  const refresh = stringValue(record.refresh) || stringValue(record.refreshToken) || access;
  if (refresh === access) return credentialsFromApiKey(access);

  return credentialsFromAuth({
    accessToken: access,
    refreshToken: refresh,
    expiresAt: record.expires ?? record.expiresAt,
    accountId: stringValue(record.accountId),
  });
}

function credentialsFromApiKey(apiKey: string): Credentials {
  return {
    access: apiKey,
    refresh: apiKey,
    expires: Date.now() + TEN_YEARS_MS,
  };
}

function parseClineAuthPayload(
  payload: JsonRecord | undefined,
  context: string,
  options: ParseClineAuthPayloadOptions = {},
): RefreshAuthResult {
  const data = payload?.data;
  const accessToken = stringValue(data?.accessToken);
  if (!accessToken) throw new Error(`${context} did not include an access token.`);
  const refreshToken = stringValue(data?.refreshToken);
  if (options.requireRefreshToken && !refreshToken) throw new Error(`${context} did not include a refresh token.`);

  const result: RefreshAuthResult = {
    accessToken,
    expiresAt: data?.expiresAt,
  };
  if (refreshToken) result.refreshToken = refreshToken;
  const accountId = stringValue(data?.userInfo?.clineUserId)
    || stringValue(data?.userInfo?.accountId)
    || stringValue(data?.accountId);
  if (accountId) result.accountId = accountId;
  return result;
}

function safeRefreshErrorDetail(payload: JsonRecord | undefined, status: number): string {
  const code = stringValue(payload?.code) || stringValue(payload?.errorCode);
  if (/^[a-z0-9_.-]{1,64}$/i.test(code)) return code;
  return `HTTP ${status}`;
}

function safeOAuthErrorDetail(payload: JsonRecord | undefined, status: number): string {
  const code = stringValue(payload?.error) || stringValue(payload?.code) || stringValue(payload?.errorCode);
  if (/^[a-z0-9_.-]{1,64}$/i.test(code)) return code;
  const message = stringValue(payload?.error_description) || stringValue(payload?.message);
  if (message) return sanitizeErrorDetail(message);
  return `HTTP ${status}`;
}

function sanitizeCredentialInput(input: unknown): string {
  const cleaned = Array.from(String(input || ""))
    .filter(char => {
      const code = char.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .trim();
  return cleaned.replace(/^['"`]+|['"`]+$/g, "").trim();
}

function formatClineAccountAccessToken(token: unknown): string {
  const value = stringValue(token);
  if (!value) return "";
  return value.toLowerCase().startsWith(CLINE_WORKOS_ACCESS_TOKEN_PREFIX) ? value : `${CLINE_WORKOS_ACCESS_TOKEN_PREFIX}${value}`;
}

function stripClineAccountAccessTokenPrefix(token: unknown): string {
  const value = stringValue(token);
  if (!value) return "";
  return value.toLowerCase().startsWith(CLINE_WORKOS_ACCESS_TOKEN_PREFIX)
    ? value.slice(CLINE_WORKOS_ACCESS_TOKEN_PREFIX.length)
    : value;
}

function isClineAccountAuthExpired(auth: ClineProviderAuth | undefined, accessToken: string, skewMs = 0): boolean {
  const expiry = clineAccountExpiryTimeMs(auth, accessToken);
  return expiry === undefined || expiry <= Date.now() + skewMs;
}

function clineAccountExpiryTimeMs(auth: ClineProviderAuth | undefined, accessToken: string): number | undefined {
  return expiryTimeMs(auth?.expiresAt) ?? jwtExpiryTimeMs(stripClineAccountAccessTokenPrefix(accessToken));
}

function jwtExpiryTimeMs(token: string): number | undefined {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as JsonRecord;
    const exp = Number(payload.exp);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

function verificationUriWithCode(device: ClineDeviceAuthorization): string {
  try {
    const url = new URL(device.verificationUri);
    url.searchParams.set("user_code", device.userCode);
    return url.toString();
  } catch {
    return device.verificationUri;
  }
}

function positiveInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : undefined;
}

function withAbortSignal(init: RequestInit, signal?: AbortSignal): RequestInit {
  return signal ? { ...init, signal } : init;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error("Cline login was cancelled.");
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("Cline login was cancelled."));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function sanitizeErrorDetail(input: string): string {
  return String(input).replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]");
}

function toWireModelId(model: unknown): string {
  const value = stringValue(model) || DEFAULT_MODEL;
  return value.startsWith(`${PROVIDER_ID}/`) ? value : `${PROVIDER_ID}/${value}`;
}

function fromWireModelId(model: unknown): string {
  const value = String(model || "");
  return value.startsWith(`${PROVIDER_ID}/`) ? value.slice(PROVIDER_ID.length + 1) : value;
}

function describeExpiry(value: unknown): { expired: boolean; detail: string } | undefined {
  const timeMs = expiryTimeMs(value);
  if (timeMs === undefined) return undefined;
  const expired = timeMs <= Date.now();
  return { expired, detail: expired ? "expired" : "present" };
}

function isExpired(value: unknown, skewMs = 0): boolean {
  const timeMs = expiryTimeMs(value);
  return timeMs !== undefined && timeMs <= Date.now() + skewMs;
}

function expiryTimeMs(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  }
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? undefined : parsed;
}

function tokenize(args: string): string[] {
  const tokens: string[] = [];
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

function camelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_match, char: string) => char.toUpperCase());
}

function parseBoolean(value: string, key: string): boolean {
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(`Invalid boolean for --${key}: ${value}`);
}

function stringValue(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
