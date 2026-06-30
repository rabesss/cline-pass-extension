import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CLINE_ACCOUNT_PROVIDER_ID, CLINE_API_KEY_ENV_VAR, CLINE_PASS_ACCESS_TOKEN_ENV_VAR, CLINE_PASS_API_KEY_ENV_VAR, CLINE_PASS_OMP_AGENT_DB_ENV_VAR, CLINE_WORKOS_ACCESS_TOKEN_PREFIX, DEFAULT_SOURCE_PATH, PROVIDER_ID, TEN_YEARS_MS, } from "./constants.js";
import { expandHome, expiryTimeMs, isExpired, safeError, stringValue, } from "./utils.js";
export function resolveProvidersPath(env = process.env) {
    if (env.CLINE_PROVIDERS_JSON)
        return path.resolve(expandHome(env.CLINE_PROVIDERS_JSON, env));
    if (env.CLINE_DATA_DIR)
        return path.resolve(expandHome(path.join(env.CLINE_DATA_DIR, "settings", "providers.json"), env));
    return path.resolve(expandHome(DEFAULT_SOURCE_PATH, env));
}
export async function readClinePassAccessToken(options = {}) {
    const credentials = await readClinePassCredentials(options);
    return credentials.access;
}
export async function readClinePassCredentials(options = {}) {
    const env = options.env || process.env;
    const envApiKey = stringValue(env.CLINE_PASS_API_KEY) || stringValue(env.CLINE_API_KEY);
    if (envApiKey)
        return credentialsFromApiKey(envApiKey);
    const envToken = stringValue(env.CLINE_PASS_ACCESS_TOKEN);
    if (envToken)
        return credentialsFromAuth({ accessToken: envToken });
    const providersPath = options.path || resolveProvidersPath(env);
    const settings = await readProviderSettings(providersPath);
    const provider = findClineAuthProviderEntry(settings);
    const token = stringValue(provider?.auth?.accessToken);
    if (!provider || !token)
        throw new Error("Cline access token not found. Sign in with Cline first.");
    if (!isClineAccountAuthExpired(provider.auth, token, options.refreshSkewMs ?? 60_000)) {
        return credentialsFromAuth(provider.auth, token);
    }
    throw new Error("Cline Pass access token is expired. Refresh your Cline app session or set CLINE_PASS_API_KEY.");
}
export async function loginClinePass(callbacks = {}) {
    const envApiKey = stringValue(process.env.CLINE_PASS_API_KEY) || stringValue(process.env.CLINE_API_KEY);
    if (envApiKey)
        return credentialsFromApiKey(envApiKey);
    if (process.env.CLINE_PASS_IMPORT_LOCAL === "1") {
        return readClinePassCredentials();
    }
    await callbacks.onAuth?.({
        url: "https://app.cline.bot/settings/api-keys",
        instructions: "Create a Cline API key, then paste it into the prompt.",
    });
    if (typeof callbacks.onPrompt !== "function") {
        throw new Error("Run /login in OMP and paste a Cline API key, or set CLINE_PASS_API_KEY.");
    }
    const apiKey = sanitizeCredentialInput(await callbacks.onPrompt({ message: "Paste a Cline API key for Cline Pass, or leave blank to cancel:" }));
    if (!apiKey)
        throw new Error("No Cline API key provided.");
    return credentialsFromApiKey(apiKey);
}
export async function refreshClinePassCredentials(credentials, _options = {}) {
    const access = stringValue(credentials?.access);
    const refresh = stringValue(credentials?.refresh);
    if (access && refresh === access)
        return credentialsFromApiKey(access);
    throw new Error("Cline Pass credential refresh is unsupported. Use a Cline API key or refresh the Cline app session.");
}
export function getClinePassApiKey(credentials) {
    return stringValue(credentials?.access);
}
export async function readProviderSettings(providersPath) {
    let data;
    try {
        data = await fs.readFile(providersPath, "utf8");
    }
    catch (error) {
        throw new Error(`Unable to read Cline providers.json at ${providersPath}: ${safeError(error)}`);
    }
    try {
        return JSON.parse(data);
    }
    catch (error) {
        throw new Error(`Unable to parse Cline providers.json at ${providersPath}: ${safeError(error)}`);
    }
}
export function findClinePassProvider(settings) {
    const provider = findClinePassProviderEntry(settings);
    if (!provider)
        return undefined;
    const result = {
        ...provider.settings,
    };
    if (provider.auth)
        result.auth = provider.auth;
    return result;
}
function findClinePassProviderEntry(settings) {
    return findClineProviderEntry(settings, [PROVIDER_ID]);
}
export function findClineAuthProviderEntry(settings) {
    return findClineProviderEntry(settings, [CLINE_ACCOUNT_PROVIDER_ID, PROVIDER_ID]);
}
function findClineProviderEntry(settings, providerIds) {
    const providers = settings?.providers;
    if (!providers || typeof providers !== "object")
        return undefined;
    const normalizedProviderIds = providerIds.map(providerId => providerId.trim().toLowerCase());
    for (const expectedProviderId of normalizedProviderIds) {
        for (const [key, value] of Object.entries(providers)) {
            const entry = value && typeof value === "object" ? value : {};
            const providerSettings = entry.settings && typeof entry.settings === "object" ? entry.settings : entry;
            const providerId = stringValue(providerSettings.provider) || key;
            if (providerId.trim().toLowerCase() !== expectedProviderId)
                continue;
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
export async function resolveRuntimeApiKey(options = {}, env = process.env) {
    const optionKey = stringValue(options.apiKey);
    if (optionKey && !isEnvVarReference(optionKey)) {
        return accessTokenFromRuntimeOption(optionKey) || optionKey;
    }
    const envApiKey = stringValue(env.CLINE_PASS_API_KEY) || stringValue(env.CLINE_API_KEY);
    if (envApiKey)
        return envApiKey;
    const envAccessToken = stringValue(env.CLINE_PASS_ACCESS_TOKEN);
    if (envAccessToken)
        return formatClineAccountAccessToken(envAccessToken);
    if (env.CLINE_PASS_IMPORT_LOCAL === "1") {
        const readOptions = {
            env,
            persist: false,
        };
        if (options.baseUrl)
            readOptions.baseUrl = options.baseUrl;
        if (options.fetchImpl)
            readOptions.fetchImpl = options.fetchImpl;
        try {
            return await readClinePassAccessToken(readOptions);
        }
        catch (error) {
            throw new Error(`Unable to resolve imported local Cline credential: ${safeError(error)}`);
        }
    }
    const stored = await readOmpSavedClinePassCredentials(env).catch(() => undefined);
    if (stored) {
        if (!isExpired(stored.expires, 60_000))
            return stored.access;
        throw new Error("Saved Cline Pass credential is expired. Run /login with a Cline API key or set CLINE_PASS_API_KEY.");
    }
    return "";
}
export function missingApiKeyMessage() {
    return "No Cline Pass credential. Run /login and paste a Cline API key, set CLINE_PASS_API_KEY, or set CLINE_PASS_IMPORT_LOCAL=1 to read an existing local Cline app token.";
}
function isEnvVarReference(value) {
    return [CLINE_PASS_API_KEY_ENV_VAR, CLINE_API_KEY_ENV_VAR, CLINE_PASS_ACCESS_TOKEN_ENV_VAR].some(key => value === key || value === `$${key}` || value === `\${${key}}`);
}
function accessTokenFromRuntimeOption(value) {
    if (!value.startsWith("{"))
        return "";
    let parsed;
    try {
        parsed = JSON.parse(value);
    }
    catch {
        return "";
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return "";
    const record = parsed;
    const key = stringValue(record.key);
    if (key)
        return key;
    return credentialsFromStoredOAuthData(record)?.access || "";
}
async function readOmpSavedClinePassCredentials(env = process.env) {
    for (const dbPath of resolveOmpAgentDbPathCandidates(env)) {
        if (!(await fileExists(dbPath)))
            continue;
        const raw = await readOmpAuthCredentialData(dbPath);
        const credentials = raw ? credentialsFromStoredOAuthData(raw) : undefined;
        if (credentials?.access)
            return credentials;
    }
    return undefined;
}
function resolveOmpAgentDbPathCandidates(env = process.env) {
    const explicit = stringValue(env[CLINE_PASS_OMP_AGENT_DB_ENV_VAR]);
    if (explicit)
        return [path.resolve(expandHome(explicit, env))];
    const candidates = new Set();
    const home = env.HOME || os.homedir();
    const agentDir = stringValue(env.PI_CODING_AGENT_DIR) || stringValue(env.OMP_AGENT_DIR);
    if (agentDir)
        candidates.add(path.resolve(expandHome(path.join(agentDir, "agent.db"), env)));
    const configDir = stringValue(env.PI_CONFIG_DIR) || ".omp";
    const profile = normalizeOmpProfileName(stringValue(env.OMP_PROFILE) || stringValue(env.PI_PROFILE));
    const xdgDataHome = stringValue(env.XDG_DATA_HOME);
    if (profile) {
        candidates.add(path.join(home, configDir, "profiles", profile, "agent", "agent.db"));
        if (xdgDataHome)
            candidates.add(path.join(expandHome(xdgDataHome, env), "omp", "profiles", profile, "agent.db"));
    }
    else if (xdgDataHome) {
        candidates.add(path.join(expandHome(xdgDataHome, env), "omp", "agent.db"));
    }
    candidates.add(path.join(home, configDir, "agent", "agent.db"));
    return [...candidates];
}
function normalizeOmpProfileName(value) {
    if (!value || value === "default")
        return "";
    return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value) ? value : "";
}
async function fileExists(filePath) {
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
async function readOmpAuthCredentialData(dbPath) {
    return (await readOmpAuthCredentialDataWithBunSqlite(dbPath)) || readOmpAuthCredentialDataWithSqliteCli(dbPath);
}
async function readOmpAuthCredentialDataWithBunSqlite(dbPath) {
    try {
        if (!("Bun" in globalThis))
            return "";
        // bun:sqlite is only resolvable in Bun; keep Node from statically resolving it.
        const dynamicImport = new Function("specifier", "return import(specifier)");
        const mod = await dynamicImport("bun:sqlite");
        if (typeof mod.Database !== "function")
            return "";
        const db = new mod.Database(dbPath, { readonly: true });
        try {
            const row = db.query(OMP_AUTH_SQL).get(PROVIDER_ID);
            return stringValue(row?.data);
        }
        finally {
            db.close();
        }
    }
    catch {
        return "";
    }
}
function readOmpAuthCredentialDataWithSqliteCli(dbPath) {
    try {
        const result = spawnSync("sqlite3", ["-batch", "-noheader", "-readonly", dbPath, OMP_AUTH_SQLITE_CLI_SQL], {
            encoding: "utf8",
            maxBuffer: 1024 * 1024,
            timeout: 5_000,
        });
        if (result.status !== 0 || result.error)
            return "";
        return stringValue(result.stdout);
    }
    catch {
        return "";
    }
}
function credentialsFromAuth(auth, accessOverride) {
    const rawAccess = stringValue(accessOverride) || stringValue(auth?.accessToken);
    const access = formatClineAccountAccessToken(rawAccess);
    const refresh = stringValue(auth?.refreshToken) || access;
    return {
        access,
        refresh,
        expires: clineAccountExpiryTimeMs(auth, access) ?? Date.now() + TEN_YEARS_MS,
    };
}
function credentialsFromStoredOAuthData(data) {
    let record;
    if (typeof data === "string") {
        try {
            const parsed = JSON.parse(data);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
                return undefined;
            record = parsed;
        }
        catch {
            return undefined;
        }
    }
    else {
        record = data;
    }
    const access = stringValue(record.access) || stringValue(record.accessToken);
    if (!access)
        return undefined;
    const refresh = stringValue(record.refresh) || stringValue(record.refreshToken) || access;
    if (refresh === access)
        return credentialsFromApiKey(access);
    return credentialsFromAuth({
        accessToken: access,
        refreshToken: refresh,
        expiresAt: record.expires ?? record.expiresAt,
        accountId: stringValue(record.accountId),
    });
}
function credentialsFromApiKey(apiKey) {
    return {
        access: apiKey,
        refresh: apiKey,
        expires: Date.now() + TEN_YEARS_MS,
    };
}
function sanitizeCredentialInput(input) {
    const cleaned = Array.from(String(input || ""))
        .filter(char => {
        const code = char.charCodeAt(0);
        return code > 31 && code !== 127;
    })
        .join("")
        .trim();
    return cleaned.replace(/^['"`]+|['"`]+$/g, "").trim();
}
function formatClineAccountAccessToken(token) {
    const value = stringValue(token);
    if (!value)
        return "";
    return value.toLowerCase().startsWith(CLINE_WORKOS_ACCESS_TOKEN_PREFIX) ? value : `${CLINE_WORKOS_ACCESS_TOKEN_PREFIX}${value}`;
}
function stripClineAccountAccessTokenPrefix(token) {
    const value = stringValue(token);
    if (!value)
        return "";
    return value.toLowerCase().startsWith(CLINE_WORKOS_ACCESS_TOKEN_PREFIX)
        ? value.slice(CLINE_WORKOS_ACCESS_TOKEN_PREFIX.length)
        : value;
}
function isClineAccountAuthExpired(auth, accessToken, skewMs = 0) {
    const expiry = clineAccountExpiryTimeMs(auth, accessToken);
    return expiry !== undefined && expiry <= Date.now() + skewMs;
}
function clineAccountExpiryTimeMs(auth, accessToken) {
    return expiryTimeMs(auth?.expiresAt) ?? jwtExpiryTimeMs(stripClineAccountAccessTokenPrefix(accessToken));
}
function jwtExpiryTimeMs(token) {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[1])
        return undefined;
    try {
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
        const exp = Number(payload.exp);
        return Number.isFinite(exp) && exp > 0 ? exp * 1000 : undefined;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=auth.js.map