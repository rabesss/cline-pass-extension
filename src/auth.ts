import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CLINE_ACCOUNT_PROVIDER_ID,
  CLINE_API_BASE,
  CLINE_API_KEY_ENV_VAR,
  CLINE_PASS_ACCESS_TOKEN_ENV_VAR,
  CLINE_PASS_API_KEY_ENV_VAR,
  CLINE_PASS_OMP_AGENT_DB_ENV_VAR,
  CLINE_WORKOS_ACCESS_TOKEN_PREFIX,
  CLINE_WORKOS_API_BASE,
  CLINE_WORKOS_CLIENT_ID,
  DEFAULT_SOURCE_PATH,
  PROVIDER_ID,
  TEN_YEARS_MS,
} from "./constants.js";
import type {
  ClineDeviceAuthorization,
  ClineProviderAuth,
  ClineProviderSettings,
  ClineSettings,
  Credentials,
  Env,
  FetchLike,
  FoundClineProvider,
  JsonRecord,
  LoginCallbacks,
  ParseClineAuthPayloadOptions,
  ReadCredentialsOptions,
  RefreshAuthOptions,
  RefreshAuthResult,
  RefreshCredentialsOptions,
  RuntimeApiKeyOptions,
  WorkosTokenResult,
} from "./types.js";
import {
  delay,
  expandHome,
  expiryTimeMs,
  isExpired,
  normalizeBaseUrl,
  optionalNonNegativeInteger,
  positiveInteger,
  safeError,
  sanitizeErrorDetail,
  stringValue,
  throwIfAborted,
  verificationUriWithCode,
  withAbortSignal,
} from "./utils.js";

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

  const refreshFetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
  const refreshOptions: RefreshAuthOptions = {
    baseUrl: options.baseUrl || env.CLINE_PASS_API_BASE || CLINE_API_BASE,
  };
  if (refreshFetchImpl) refreshOptions.fetchImpl = refreshFetchImpl;
  const refreshed = await refreshClinePassAuth(refreshToken, refreshOptions);
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
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
  if (typeof fetchImpl !== "function") throw new Error("global fetch is not available; use Node 18+ or a runtime with fetch");

  const baseUrl = normalizeBaseUrl(options.baseUrl || CLINE_API_BASE);
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

  const fetchImpl = callbacks.fetch ?? (globalThis.fetch as FetchLike | undefined);
  if (typeof fetchImpl !== "function") throw new Error("global fetch is not available; use Node 18+ or a runtime with fetch");

  const apiBaseUrl = normalizeBaseUrl(process.env.CLINE_PASS_API_BASE || CLINE_API_BASE);
  const workosApiBaseUrl = normalizeBaseUrl(process.env.CLINE_PASS_WORKOS_API_BASE || CLINE_WORKOS_API_BASE);
  const clientId = stringValue(process.env.CLINE_PASS_WORKOS_CLIENT_ID) || CLINE_WORKOS_CLIENT_ID;
  const device = await startClineDeviceAuthorization({ fetchImpl, workosApiBaseUrl, clientId, signal: callbacks.signal });

  await callbacks.onAuth({
    url: verificationUriWithCode(device),
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
      if (errorCode === "slow_down" && overridePollDelay === undefined) pollIntervalMs += 5_000;
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

  const refreshFetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
  const refreshOptions: RefreshAuthOptions = {
    baseUrl: options.baseUrl || process.env.CLINE_PASS_API_BASE || CLINE_API_BASE,
  };
  if (refreshFetchImpl) refreshOptions.fetchImpl = refreshFetchImpl;
  const refreshed = await refreshClinePassAuth(credentials?.refresh, refreshOptions);
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
  const targetPath = await fs.realpath(providersPath).catch(() => providersPath);
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  const mode = 0o600;
  await fs.writeFile(tmpPath, `${JSON.stringify(settings, null, 2)}\n`, { mode });
  await fs.rename(tmpPath, targetPath);
  await fs.chmod(targetPath, mode);
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

export function findClineAuthProviderEntry(settings?: ClineSettings): FoundClineProvider | undefined {
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

export async function resolveRuntimeApiKey(options: RuntimeApiKeyOptions = {}, env: Env = process.env): Promise<string> {
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
    try {
      return await readClinePassAccessToken(readOptions);
    } catch (error) {
      throw new Error(`Unable to resolve imported local Cline credential: ${safeError(error)}`);
    }
  }
  const stored = await readOmpSavedClinePassCredentials(env).catch(() => undefined);
  if (stored) {
    if (!isExpired(stored.expires, 60_000)) return stored.access;
    const refreshOptions: RefreshCredentialsOptions = {};
    if (options.baseUrl) refreshOptions.baseUrl = options.baseUrl;
    if (options.fetchImpl) refreshOptions.fetchImpl = options.fetchImpl;
    let refreshed: Credentials;
    try {
      refreshed = await refreshClinePassCredentials(stored, refreshOptions);
    } catch (error) {
      throw new Error(`Unable to refresh saved Cline Pass credential: ${safeError(error)}`);
    }
    if (refreshed?.access) return refreshed.access;
  }
  return "";
}

export function missingApiKeyMessage(): string {
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
    if (!("Bun" in globalThis)) return "";
    // bun:sqlite is only resolvable in Bun; keep Node from statically resolving it.
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
      timeout: 5_000,
    });
    if (result.status !== 0 || result.error) return "";
    return stringValue(result.stdout);
  } catch {
    return "";
  }
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
