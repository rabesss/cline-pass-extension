import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
export const PROVIDER_ID = "cline-pass";
export const PROVIDER_NAME = "Cline Pass";
export const CLINE_API_BASE = "https://api.cline.bot/api/v1";
export const CLINE_PASS_API_KEY_ENV_VAR = "CLINE_PASS_API_KEY";
export const CLINE_API_KEY_ENV_VAR = "CLINE_API_KEY";
export const CLINE_PASS_ACCESS_TOKEN_ENV_VAR = "CLINE_PASS_ACCESS_TOKEN";
export const DEFAULT_MODEL = "glm-5.2";
export const DEFAULT_WIRE_MODEL = "cline-pass/glm-5.2";
export const DEFAULT_SOURCE_PATH = "~/.cline/data/settings/providers.json";
export const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;
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
].map(([wireId, name]) => ({
    id: fromWireModelId(wireId),
    wireId,
    name,
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
}));
export function buildProviderConfig(options = {}) {
    return {
        name: PROVIDER_NAME,
        baseUrl: options.baseUrl || process.env.CLINE_PASS_API_BASE || CLINE_API_BASE,
        apiKey: options.apiKey || CLINE_PASS_API_KEY_ENV_VAR,
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
}
export function expandHome(input, env = process.env) {
    if (!input)
        return input;
    if (input === "~")
        return env.HOME || os.homedir();
    if (input.startsWith("~/"))
        return path.join(env.HOME || os.homedir(), input.slice(2));
    return input;
}
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
    const provider = findClinePassProviderEntry(settings);
    const token = stringValue(provider?.auth?.accessToken);
    if (!provider || !token)
        throw new Error("Cline Pass access token not found. Sign in with Cline first.");
    if (!isExpired(provider?.auth?.expiresAt, options.refreshSkewMs ?? 60_000)) {
        return credentialsFromAuth(provider.auth, token);
    }
    const refreshToken = stringValue(provider?.auth?.refreshToken);
    if (!refreshToken)
        throw new Error("Cline Pass access token is expired and no refresh token is available.");
    const refreshed = await refreshClinePassAuth(refreshToken, {
        baseUrl: options.baseUrl || env.CLINE_PASS_API_BASE || CLINE_API_BASE,
        fetchImpl: options.fetchImpl || fetch,
    });
    if (options.persist !== false) {
        await updateStoredClinePassAuth(providersPath, refreshToken, refreshed);
    }
    const refreshedAuth = {
        ...provider.auth,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken || refreshToken,
        expiresAt: refreshed.expiresAt,
    };
    const accountId = refreshed.accountId || provider.auth?.accountId;
    if (accountId)
        refreshedAuth.accountId = accountId;
    return credentialsFromAuth(refreshedAuth);
}
export async function refreshClinePassAuth(refreshToken, options = {}) {
    if (!stringValue(refreshToken))
        throw new Error("Cline Pass refresh token is missing.");
    const fetchImpl = options.fetchImpl || fetch;
    if (typeof fetchImpl !== "function")
        throw new Error("global fetch is not available; use Node 18+ or a runtime with fetch");
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
    const data = payload?.data;
    const accessToken = stringValue(data?.accessToken);
    const nextRefreshToken = stringValue(data?.refreshToken);
    if (!accessToken)
        throw new Error("Cline Pass token refresh response did not include an access token.");
    return {
        accessToken,
        refreshToken: nextRefreshToken,
        expiresAt: data?.expiresAt,
        accountId: stringValue(data?.userInfo?.accountId) || stringValue(data?.accountId),
    };
}
export async function loginClinePass(callbacks = {}) {
    const envApiKey = stringValue(process.env.CLINE_PASS_API_KEY) || stringValue(process.env.CLINE_API_KEY);
    if (envApiKey)
        return credentialsFromApiKey(envApiKey);
    if (process.env.CLINE_PASS_IMPORT_LOCAL === "1") {
        return readClinePassCredentials();
    }
    if (typeof callbacks.onAuth === "function") {
        await callbacks.onAuth({
            url: "https://app.cline.bot/settings/api-keys",
            instructions: "Create a Cline API key, then paste it into the prompt.",
        });
    }
    if (typeof callbacks.onPrompt !== "function") {
        throw new Error("Set CLINE_PASS_API_KEY, or run /login in OMP and paste a Cline API key.");
    }
    const apiKey = sanitizeCredentialInput(await callbacks.onPrompt({ message: "Paste your Cline API key for Cline Pass:" }));
    if (!apiKey)
        throw new Error("No Cline API key provided.");
    return credentialsFromApiKey(apiKey);
}
export async function refreshClinePassCredentials(credentials, options = {}) {
    const access = stringValue(credentials?.access);
    const refresh = stringValue(credentials?.refresh);
    if (access && refresh === access)
        return credentialsFromApiKey(access);
    const refreshed = await refreshClinePassAuth(credentials?.refresh, {
        baseUrl: options.baseUrl || process.env.CLINE_PASS_API_BASE || CLINE_API_BASE,
        fetchImpl: options.fetchImpl || fetch,
    });
    const refreshedAuth = {
        accessToken: refreshed.accessToken,
        expiresAt: refreshed.expiresAt,
    };
    const refreshToken = refreshed.refreshToken || credentials?.refresh;
    if (refreshToken)
        refreshedAuth.refreshToken = refreshToken;
    return credentialsFromAuth(refreshedAuth);
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
export async function writeProviderSettings(providersPath, settings) {
    const tmpPath = `${providersPath}.${process.pid}.${Date.now()}.tmp`;
    const mode = 0o600;
    await fs.writeFile(tmpPath, `${JSON.stringify(settings, null, 2)}\n`, { mode });
    await fs.rename(tmpPath, providersPath);
    await fs.chmod(providersPath, mode);
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
    const providers = settings?.providers;
    if (!providers || typeof providers !== "object")
        return undefined;
    for (const [key, value] of Object.entries(providers)) {
        const entry = value && typeof value === "object" ? value : {};
        const providerSettings = entry.settings && typeof entry.settings === "object" ? entry.settings : entry;
        const providerId = stringValue(providerSettings.provider) || key;
        if (providerId.trim().toLowerCase() !== PROVIDER_ID)
            continue;
        const auth = providerSettings.auth && typeof providerSettings.auth === "object"
            ? providerSettings.auth
            : entry.auth && typeof entry.auth === "object"
                ? entry.auth
                : undefined;
        return { key, entry, settings: providerSettings, auth };
    }
    return undefined;
}
export async function doctorClinePass(env = process.env) {
    const providersPath = resolveProvidersPath(env);
    const checks = [];
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
    let settings;
    try {
        settings = await readProviderSettings(providersPath);
        checks.push({ name: "providers.json", ok: true, detail: providersPath });
    }
    catch (error) {
        checks.push({ name: "providers.json", ok: false, detail: safeError(error) });
        return { ok: false, command: "doctor", providersPath, checks };
    }
    const provider = findClinePassProviderEntry(settings);
    checks.push({
        name: "provider",
        ok: Boolean(provider),
        detail: provider ? "cline-pass provider found" : "cline-pass provider not found",
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
export async function verifyClinePass(options = {}, env = process.env) {
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
                ? "Cline API returned HTTP 401. Create a Cline API key or re-authenticate Cline, then run /login."
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
        detail: typeof content === "string" && content.includes(sentinel)
            ? "model returned the verification sentinel"
            : "model responded, but not with the verification sentinel",
        model,
        baseUrl,
    };
}
export function parseCommandArgs(args) {
    const tokens = tokenize(args || "");
    const command = tokens.shift() || "help";
    const options = {};
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (!token)
            throw new Error("Missing argument");
        if (!token.startsWith("--"))
            throw new Error(`Unexpected argument: ${token}`);
        const eqIndex = token.indexOf("=");
        const rawKey = eqIndex >= 0 ? token.slice(2, eqIndex) : token.slice(2);
        const key = camelCase(rawKey);
        const inlineValue = eqIndex >= 0 ? token.slice(eqIndex + 1) : undefined;
        if (["json"].includes(key)) {
            options[key] = (inlineValue === undefined ? true : parseBoolean(inlineValue, rawKey));
            continue;
        }
        const value = inlineValue ?? tokens[++index];
        if (!value || value.startsWith("--"))
            throw new Error(`Missing value for --${rawKey}`);
        options[key] = value;
    }
    return { command, options };
}
export async function runClinePassCommand(args, env = process.env) {
    const { command, options } = parseCommandArgs(args);
    let result;
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
export function commandUsage() {
    return [
        "Usage: /clinepass <doctor|verify|models> [options]",
        "",
        "Options:",
        "  --model <id>      Verification model",
        "  --base-url <url>  Cline API base URL",
        "  --json            Return JSON",
    ].join("\n");
}
export function formatCommandResult(result, json = false) {
    if (json || result.json)
        return JSON.stringify(toSafeResult(result), null, 2);
    if (result.command === "help")
        return result.detail;
    if (result.command === "doctor") {
        return result.checks.map(check => `${check.ok ? "OK" : "FAIL"} ${check.name}: ${check.detail}`).join("\n");
    }
    if (result.command === "models")
        return result.models.join("\n");
    const status = result.ok ? "OK" : "FAIL";
    return `${status} clinepass ${result.command}: ${result.detail}`;
}
class ClinePassEventStream {
    queue = [];
    waiting = [];
    done = false;
    push(event) {
        if (this.done)
            return;
        if (event.type === "done" || event.type === "error")
            this.done = true;
        const waiter = this.waiting.shift();
        if (waiter)
            waiter.resolve({ value: event, done: false });
        else
            this.queue.push(event);
    }
    end() {
        this.done = true;
        while (this.waiting.length > 0)
            this.waiting.shift()?.resolve({ value: undefined, done: true });
    }
    async *[Symbol.asyncIterator]() {
        while (true) {
            const next = this.queue.shift();
            if (next) {
                yield next;
            }
            else if (this.done) {
                return;
            }
            else {
                const event = await new Promise(resolve => this.waiting.push({ resolve }));
                if (event.done)
                    return;
                yield event.value;
            }
        }
    }
}
export function createStreamClinePass(deps = {}) {
    const apiBase = deps.baseUrl || deps.apiBase || process.env.CLINE_PASS_API_BASE || CLINE_API_BASE;
    const fetchImpl = deps.fetchImpl || fetch;
    const createStream = deps.createStream || (() => new ClinePassEventStream());
    const now = deps.now || (() => Date.now());
    return function streamClinePass(model = {}, context = {}, options = {}) {
        const stream = createStream();
        async function run() {
            const output = {
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
                const payload = {
                    model: toWireModelId(model?.id || DEFAULT_MODEL),
                    messages: messagesToOpenAI(context),
                    stream: true,
                    max_tokens: Math.min(options.maxTokens || model?.maxTokens || 16384, model?.maxTokens || 16384),
                };
                const tools = toolsToOpenAI(context?.tools);
                if (tools.length > 0)
                    payload.tools = tools;
                if (options.toolChoice)
                    payload.tool_choice = options.toolChoice;
                if (typeof options.onPayload === "function")
                    await options.onPayload(payload, model);
                const init = {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(payload),
                };
                if (options.signal)
                    init.signal = options.signal;
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
            }
            catch (error) {
                output.stopReason = error instanceof Error && error.name === "AbortError" ? "aborted" : "error";
                output.errorMessage = error instanceof Error ? error.message : String(error);
                stream.push({ type: "error", reason: output.stopReason === "aborted" ? "aborted" : "error", error: output });
            }
            finally {
                stream.end();
            }
        }
        queueMicrotask(run);
        return stream;
    };
}
async function consumeOpenAIStream(body, output, stream, model) {
    let textBlock;
    let textIndex = -1;
    let finishReason;
    const toolCalls = new Map();
    for await (const payload of readOpenAISsePayloads(body)) {
        if (payload === "[DONE]")
            break;
        let chunk;
        try {
            chunk = JSON.parse(payload);
        }
        catch {
            throw new Error("Cline API returned an invalid streaming JSON chunk.");
        }
        if (chunk.usage)
            applyUsage(output.usage, chunk.usage, model);
        const choice = chunk.choices?.[0] || {};
        if (choice.finish_reason)
            finishReason = choice.finish_reason;
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
            if (id)
                pending.id = id;
            if (name)
                pending.name = name;
            if (typeof tool.function?.arguments === "string")
                pending.arguments += tool.function.arguments;
            toolCalls.set(index, pending);
        }
    }
    if (textBlock) {
        stream.push({ type: "text_end", contentIndex: textIndex, content: stringValue(textBlock.text), partial: output });
    }
    emitPendingToolCalls(toolCalls, output, stream);
    return { finishReason, toolUse: toolCalls.size > 0 };
}
async function consumeOpenAINonStreamingFallback(response, output, stream, model) {
    const data = await response.json().catch(() => undefined);
    if (!data)
        throw new Error("Cline API returned a streaming response without a readable body.");
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
    const toolCalls = new Map();
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
function emitPendingToolCalls(pendingToolCalls, output, stream) {
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
async function* readOpenAISsePayloads(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const parsed = consumeSseLines(buffer);
            buffer = parsed.rest;
            yield* parsed.payloads;
        }
        buffer += decoder.decode();
        if (buffer.trim())
            yield* consumeSseLines(`${buffer}\n`, true).payloads;
    }
    finally {
        reader.releaseLock();
    }
}
function consumeSseLines(buffer, flush = false) {
    const lines = buffer.split(/\r?\n/);
    const rest = flush ? "" : lines.pop() || "";
    const payloads = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:"))
            continue;
        const payload = trimmed.slice(5).trim();
        if (payload)
            payloads.push(payload);
    }
    return { payloads, rest };
}
function toSafeResult(result) {
    return JSON.parse(JSON.stringify(result, (key, value) => {
        if (/token|secret|apikey|authorization/i.test(key))
            return value ? "[redacted]" : value;
        return value;
    }));
}
async function resolveRuntimeApiKey(options = {}, env = process.env) {
    const optionKey = stringValue(options.apiKey);
    if (optionKey && !isEnvVarReference(optionKey))
        return optionKey;
    const envApiKey = stringValue(env.CLINE_PASS_API_KEY) || stringValue(env.CLINE_API_KEY);
    if (envApiKey)
        return envApiKey;
    const envAccessToken = stringValue(env.CLINE_PASS_ACCESS_TOKEN);
    if (envAccessToken)
        return envAccessToken;
    if (env.CLINE_PASS_IMPORT_LOCAL !== "1")
        return "";
    const readOptions = {
        env,
        persist: false,
    };
    if (options.baseUrl)
        readOptions.baseUrl = options.baseUrl;
    if (options.fetchImpl)
        readOptions.fetchImpl = options.fetchImpl;
    return readClinePassAccessToken(readOptions).catch(() => "");
}
function missingApiKeyMessage() {
    return "No Cline API key. Run /login and paste a Cline API key, or set CLINE_PASS_API_KEY. Set CLINE_PASS_IMPORT_LOCAL=1 only if you want to try an existing local Cline account token.";
}
function isEnvVarReference(value) {
    return [CLINE_PASS_API_KEY_ENV_VAR, CLINE_API_KEY_ENV_VAR, CLINE_PASS_ACCESS_TOKEN_ENV_VAR].includes(value);
}
function messagesToOpenAI(context = {}) {
    const messages = [];
    const knownToolCallIds = new Set();
    const systemPrompt = Array.isArray(context.systemPrompt) ? context.systemPrompt.join("\n\n") : stringValue(context.systemPrompt);
    if (systemPrompt)
        messages.push({ role: "system", content: systemPrompt });
    for (const message of context.messages || []) {
        const role = ["system", "user", "assistant", "tool"].includes(stringValue(message.role)) ? stringValue(message.role) : "user";
        if (role === "assistant") {
            const assistant = { role, content: textFromContent(message.content) };
            const toolCalls = assistantToolCalls(message.content);
            const validToolCalls = toolCalls.filter(toolCall => stringValue(toolCall.id));
            for (const toolCall of validToolCalls)
                knownToolCallIds.add(stringValue(toolCall.id));
            if (validToolCalls.length > 0)
                assistant.tool_calls = validToolCalls;
            messages.push(assistant);
        }
        else if (role === "tool") {
            const toolCallId = stringValue(message.toolCallId);
            if (!toolCallId)
                throw new Error("Tool messages must include a non-empty toolCallId.");
            if (!knownToolCallIds.has(toolCallId)) {
                throw new Error(`Tool message references unknown toolCallId: ${toolCallId}`);
            }
            messages.push({
                role,
                tool_call_id: toolCallId,
                content: textFromContent(message.content),
            });
        }
        else {
            messages.push({ role, content: textFromContent(message.content) });
        }
    }
    if (messages.length === 0)
        messages.push({ role: "user", content: "" });
    return messages;
}
function textFromContent(content) {
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        return content == null ? "" : String(content);
    return content.map(part => {
        if (typeof part === "string")
            return part;
        if (part?.type === "text")
            return stringValue(part.text);
        if (part?.type === "thinking")
            return stringValue(part.thinking);
        return "";
    }).filter(Boolean).join("\n");
}
function assistantToolCalls(content) {
    if (!Array.isArray(content))
        return [];
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
function toolsToOpenAI(tools = []) {
    if (!Array.isArray(tools))
        return [];
    return tools.map(tool => ({
        type: "function",
        function: {
            name: tool.name,
            description: tool.description || "",
            parameters: tool.parameters || {},
        },
    }));
}
function headersToRecord(headers) {
    const out = {};
    if (!headers || typeof headers.forEach !== "function")
        return out;
    headers.forEach((value, key) => {
        out[key] = value;
    });
    return out;
}
function parseToolArguments(input) {
    if (!input)
        return {};
    if (typeof input === "object")
        return input;
    try {
        return JSON.parse(String(input));
    }
    catch {
        return {};
    }
}
function applyUsage(usage, source, model = {}) {
    usage.input = numberValue(source?.prompt_tokens);
    usage.output = numberValue(source?.completion_tokens);
    usage.totalTokens = numberValue(source?.total_tokens) || usage.input + usage.output;
    if (!model?.cost)
        return;
    usage.cost.input = (model.cost.input / 1_000_000) * usage.input;
    usage.cost.output = (model.cost.output / 1_000_000) * usage.output;
    usage.cost.total = usage.cost.input + usage.cost.output;
}
function defaultUsage() {
    return {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
}
function finishReason(reason) {
    return reason === "length" ? "length" : "stop";
}
function clineHTTPErrorMessage(status, body) {
    if (status === 401)
        return "Cline API returned HTTP 401. Run /login with a Cline API key or re-authenticate Cline.";
    const detail = stringValue(body?.error) || stringValue(body?.message);
    return detail ? `Cline API returned HTTP ${status}: ${sanitizeErrorDetail(detail)}` : `Cline API returned HTTP ${status}`;
}
async function updateStoredClinePassAuth(providersPath, expectedRefreshToken, refreshed) {
    const latest = await readProviderSettings(providersPath);
    const provider = findClinePassProviderEntry(latest);
    if (!provider)
        return;
    const currentRefreshToken = stringValue(provider.auth?.refreshToken);
    if (currentRefreshToken && currentRefreshToken !== expectedRefreshToken)
        return;
    const authTarget = provider.auth || {};
    authTarget.accessToken = refreshed.accessToken;
    authTarget.refreshToken = refreshed.refreshToken || expectedRefreshToken;
    authTarget.expiresAt = refreshed.expiresAt;
    if (refreshed.accountId)
        authTarget.accountId = refreshed.accountId;
    if (provider.settings.auth && typeof provider.settings.auth === "object") {
        provider.settings.auth = authTarget;
    }
    else if (provider.entry.auth && typeof provider.entry.auth === "object") {
        provider.entry.auth = authTarget;
    }
    else {
        provider.settings.auth = authTarget;
    }
    await writeProviderSettings(providersPath, latest);
}
function credentialsFromAuth(auth, accessOverride) {
    const access = stringValue(accessOverride) || stringValue(auth?.accessToken);
    const refresh = stringValue(auth?.refreshToken) || access;
    return {
        access,
        refresh,
        expires: expiryTimeMs(auth?.expiresAt) || Date.now() + 3_600_000,
    };
}
function credentialsFromApiKey(apiKey) {
    return {
        access: apiKey,
        refresh: apiKey,
        expires: Date.now() + TEN_YEARS_MS,
    };
}
function safeRefreshErrorDetail(payload, status) {
    const code = stringValue(payload?.code) || stringValue(payload?.errorCode);
    if (/^[a-z0-9_.-]{1,64}$/i.test(code))
        return code;
    return `HTTP ${status}`;
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
function sanitizeErrorDetail(input) {
    return String(input).replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]");
}
function toWireModelId(model) {
    const value = stringValue(model) || DEFAULT_MODEL;
    return value.startsWith(`${PROVIDER_ID}/`) ? value : `${PROVIDER_ID}/${value}`;
}
function fromWireModelId(model) {
    const value = String(model || "");
    return value.startsWith(`${PROVIDER_ID}/`) ? value.slice(PROVIDER_ID.length + 1) : value;
}
function describeExpiry(value) {
    const timeMs = expiryTimeMs(value);
    if (timeMs === undefined)
        return undefined;
    const expired = timeMs <= Date.now();
    return { expired, detail: expired ? "expired" : "present" };
}
function isExpired(value, skewMs = 0) {
    const timeMs = expiryTimeMs(value);
    return timeMs !== undefined && timeMs <= Date.now() + skewMs;
}
function expiryTimeMs(value) {
    if (value === undefined || value === null || value === "")
        return undefined;
    const numeric = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(numeric)) {
        return numeric > 10_000_000_000 ? numeric : numeric * 1000;
    }
    if (typeof value !== "string")
        return undefined;
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? undefined : parsed;
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
            if (char === quote)
                quote = "";
            else
                current += char;
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
    if (escaping)
        current += "\\";
    if (quote)
        throw new Error("Unclosed quote in arguments");
    if (current)
        tokens.push(current);
    return tokens;
}
function camelCase(value) {
    return value.replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
}
function parseBoolean(value, key) {
    if (["1", "true", "yes", "on"].includes(value))
        return true;
    if (["0", "false", "no", "off"].includes(value))
        return false;
    throw new Error(`Invalid boolean for --${key}: ${value}`);
}
function stringValue(value) {
    return typeof value === "string" && value.trim() ? value.trim() : "";
}
function numberValue(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function safeError(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=core.js.map