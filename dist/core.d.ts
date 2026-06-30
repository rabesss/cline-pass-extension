export declare const PROVIDER_ID = "cline-pass";
export declare const PROVIDER_NAME = "Cline Pass";
export declare const CLINE_API_BASE = "https://api.cline.bot/api/v1";
export declare const CLINE_PASS_API_KEY_ENV_VAR = "CLINE_PASS_API_KEY";
export declare const CLINE_PASS_OMP_AGENT_DB_ENV_VAR = "CLINE_PASS_OMP_AGENT_DB";
export declare const DEFAULT_MODEL = "glm-5.2";
type Env = Record<string, string | undefined>;
type JsonRecord = Record<string, any>;
type ReasoningLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
type ReasoningOption = boolean | ReasoningLevel;
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
    onAuth?: (info: {
        url: string;
        instructions: string;
    }) => void | Promise<void>;
    onPrompt?: (prompt: {
        message: string;
    }) => string | Promise<string>;
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
interface RuntimeModel {
    api?: string;
    provider?: string;
    id?: string;
    reasoning?: boolean;
    thinkingLevelMap?: Partial<Record<ReasoningLevel, string | null>>;
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
    reasoning?: ReasoningOption;
    reasoningEffort?: ReasoningOption;
    reasoning_effort?: ReasoningOption;
    metadata?: Record<string, unknown>;
    toolChoice?: unknown;
    signal?: AbortSignal;
    onPayload?: (payload: JsonRecord, model?: RuntimeModel) => void | Promise<void>;
    onResponse?: (response: {
        status: number;
        headers: Record<string, string>;
    }, model?: RuntimeModel) => void | Promise<void>;
}
interface StreamEvent {
    type: string;
    [key: string]: unknown;
}
interface ClinePassEventSink extends AsyncIterable<StreamEvent> {
    push(event: StreamEvent): void;
    end(): void;
}
type StreamFunction = (model?: RuntimeModel, context?: StreamContext, options?: StreamOptions) => AsyncIterable<StreamEvent>;
export declare const CLINE_PASS_MODELS: ClinePassModel[];
export declare function buildProviderConfig(options?: BuildProviderOptions): ProviderConfig;
export declare function resolveProvidersPath(env?: Env): string;
export declare function readClinePassAccessToken(options?: ReadCredentialsOptions): Promise<string>;
export declare function readClinePassCredentials(options?: ReadCredentialsOptions): Promise<Credentials>;
export declare function refreshClinePassAuth(refreshToken: string | undefined, options?: RefreshAuthOptions): Promise<RefreshAuthResult>;
export declare function loginClinePass(callbacks?: LoginCallbacks): Promise<Credentials>;
export declare function loginClineAccount(callbacks?: LoginCallbacks): Promise<Credentials>;
export declare function refreshClinePassCredentials(credentials: Partial<Credentials> | undefined, options?: RefreshCredentialsOptions): Promise<Credentials>;
export declare function getClinePassApiKey(credentials?: Partial<Credentials>): string;
export declare function readProviderSettings(providersPath: string): Promise<ClineSettings>;
export declare function writeProviderSettings(providersPath: string, settings: ClineSettings): Promise<void>;
export declare function findClinePassProvider(settings: ClineSettings): (ClineProviderSettings & {
    auth?: ClineProviderAuth;
}) | undefined;
export declare function doctorClinePass(env?: Env): Promise<DoctorResult>;
export declare function verifyClinePass(options?: VerifyOptions, env?: Env): Promise<VerifyResult>;
export declare function parseCommandArgs(args: string): ParsedCommand;
export declare function runClinePassCommand(args: string, env?: Env): Promise<CommandResult>;
export declare function commandUsage(): string;
export declare function formatCommandResult(result: CommandResult, json?: boolean): string;
export declare function createStreamClinePass(deps?: BuildProviderOptions): StreamFunction;
export {};
