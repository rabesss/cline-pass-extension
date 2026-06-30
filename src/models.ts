import { DEFAULT_MODEL, DEFAULT_WIRE_MODEL, PROVIDER_ID, REASONING_LEVELS } from "./constants.js";
import type { ClinePassModel, ReasoningLevel, ReasoningOption, RuntimeModel, StreamOptions } from "./types.js";
import { stringValue } from "./utils.js";

export const CLINE_PASS_MODELS: ClinePassModel[] = ([
  [DEFAULT_WIRE_MODEL, "GLM 5.2"],
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
  thinkingLevelMap: { minimal: null, xhigh: "xhigh" },
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 16384,
}));

export function resolveReasoningEffort(model: RuntimeModel | undefined, options: StreamOptions): string | undefined {
  if (!model?.reasoning) return undefined;
  const requested =
    readReasoningOption(options, "reasoning") ??
    readReasoningOption(options, "reasoningEffort") ??
    readReasoningOption(options, "reasoning_effort") ??
    readReasoningOption(options.metadata, "reasoning") ??
    readReasoningOption(options.metadata, "reasoningEffort") ??
    readReasoningOption(options.metadata, "reasoning_effort");
  if (requested === undefined || requested === false || requested === "off") return undefined;
  const level: ReasoningLevel = requested === true ? "high" : requested;
  const mapped = model.thinkingLevelMap?.[level];
  if (mapped === null) return undefined;
  return stringValue(mapped) || level;
}

function readReasoningOption(source: unknown, key: string): ReasoningOption | undefined {
  if (!source || typeof source !== "object") return undefined;
  const value = (source as Record<string, unknown>)[key];
  if (value === true || value === false) return value;
  if (typeof value === "string" && REASONING_LEVELS.has(value)) return value as ReasoningLevel;
  return undefined;
}

export function toWireModelId(model: unknown): string {
  const value = stringValue(model) || DEFAULT_MODEL;
  return value.startsWith(`${PROVIDER_ID}/`) ? value : `${PROVIDER_ID}/${value}`;
}

export function fromWireModelId(model: unknown): string {
  const value = String(model || "");
  return value.startsWith(`${PROVIDER_ID}/`) ? value.slice(PROVIDER_ID.length + 1) : value;
}
