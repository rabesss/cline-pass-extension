export type Env = Record<string, string | undefined>;
export type JsonRecord = Record<string, any>;
export type ReasoningLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type ReasoningOption = boolean | ReasoningLevel;

export type FetchLike = (url: string, init?: RequestInit) => Promise<ResponseLike>;

export interface HeadersLike {
  forEach(callback: (value: string, key: string) => void): void;
}

export interface ResponseLike {
  ok: boolean;
  status: number;
  headers?: HeadersLike;
  body?: ReadableStream<Uint8Array> | null;
  json(): Promise<any>;
}

export interface Cost {
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
  thinkingLevelMap?: Partial<Record<ReasoningLevel, string | null>>;
  input: string[];
  cost: Cost;
  contextWindow: number;
  maxTokens: number;
}

export interface OAuthAdapter {
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

export interface BuildProviderOptions {
  baseUrl?: string;
  apiKey?: string;
  streamSimple?: StreamFunction;
  oauth?: OAuthAdapter;
  apiBase?: string;
  fetchImpl?: FetchLike;
  createStream?: () => ClinePassEventSink;
  now?: () => number;
}

export interface Credentials {
  access: string;
  refresh: string;
  expires: number;
}

export interface LoginCallbacks {
  onAuth?: (info: { url: string; instructions: string }) => void | Promise<void>;
  onPrompt?: (prompt: { message: string }) => string | Promise<string>;
  onProgress?: (message: string) => void | Promise<void>;
  fetch?: FetchLike;
  signal?: AbortSignal;
}

export interface ReadCredentialsOptions {
  env?: Env;
  path?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  persist?: boolean;
  refreshSkewMs?: number;
}

export interface RefreshCredentialsOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

export interface ClineProviderAuth {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: unknown;
  accountId?: string;
  [key: string]: unknown;
}

export interface ClineProviderSettings {
  provider?: string;
  model?: string;
  auth?: ClineProviderAuth;
  [key: string]: unknown;
}

export interface ClineProviderEntry {
  settings?: ClineProviderSettings;
  auth?: ClineProviderAuth;
  [key: string]: unknown;
}

export interface ClineSettings {
  providers?: Record<string, ClineProviderEntry>;
  [key: string]: unknown;
}

export interface FoundClineProvider {
  key: string;
  entry: ClineProviderEntry;
  settings: ClineProviderSettings;
  auth: ClineProviderAuth | undefined;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorResult {
  ok: boolean;
  command: "doctor";
  providersPath: string;
  checks: DoctorCheck[];
  json?: boolean;
}

export interface VerifyOptions {
  model?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  json?: boolean;
}

export interface VerifyResult {
  ok: boolean;
  command: "verify";
  status: number;
  detail: string;
  model: string;
  baseUrl: string;
  json?: boolean;
}

export interface ModelsResult {
  ok: boolean;
  command: "models";
  models: string[];
  json?: boolean;
}

export interface HelpResult {
  ok: boolean;
  command: "help";
  detail: string;
  json?: boolean;
}

export type CommandResult = DoctorResult | VerifyResult | ModelsResult | HelpResult;

export interface CommandOptions extends VerifyOptions {
  json?: boolean;
}

export interface ParsedCommand {
  command: string;
  options: CommandOptions;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
  totalTokens: number;
  cost: Cost & { total: number };
}

export interface RuntimeModel {
  api?: string;
  provider?: string;
  id?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Partial<Record<ReasoningLevel, string | null>>;
  maxTokens?: number;
  cost?: Cost;
}

export interface RuntimeMessage {
  role?: string;
  content?: unknown;
  toolCallId?: string;
}

export interface RuntimeTool {
  name: string;
  description?: string;
  parameters?: JsonRecord;
}

export interface StreamContext {
  systemPrompt?: string | string[];
  messages?: RuntimeMessage[];
  tools?: RuntimeTool[];
}

export interface StreamOptions {
  apiKey?: string;
  maxTokens?: number;
  reasoning?: ReasoningOption;
  reasoningEffort?: ReasoningOption;
  reasoning_effort?: ReasoningOption;
  metadata?: Record<string, unknown>;
  toolChoice?: unknown;
  signal?: AbortSignal;
  onPayload?: (payload: JsonRecord, model?: RuntimeModel) => void | Promise<void>;
  onResponse?: (response: { status: number; headers: Record<string, string> }, model?: RuntimeModel) => void | Promise<void>;
}

export interface RuntimeApiKeyOptions extends StreamOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

export interface OutputMessage {
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

export interface StreamConsumeResult {
  finishReason?: unknown;
  toolUse: boolean;
}

export interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface StreamEvent {
  type: string;
  [key: string]: unknown;
}

export interface ClinePassEventSink extends AsyncIterable<StreamEvent> {
  push(event: StreamEvent): void;
  end(): void;
}

export type StreamFunction = (
  model?: RuntimeModel,
  context?: StreamContext,
  options?: StreamOptions,
) => AsyncIterable<StreamEvent>;
