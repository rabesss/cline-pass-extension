import { DEFAULT_MODEL, DEFAULT_WIRE_MODEL, PROVIDER_ID, REASONING_LEVELS } from "./constants.js";
import { stringValue } from "./utils.js";
export const CLINE_PASS_MODELS = [
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
].map(([wireId, name]) => ({
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
export function resolveReasoningEffort(model, options) {
    if (!model?.reasoning)
        return undefined;
    const requested = readReasoningOption(options, "reasoning") ??
        readReasoningOption(options, "reasoningEffort") ??
        readReasoningOption(options, "reasoning_effort") ??
        readReasoningOption(options.metadata, "reasoning") ??
        readReasoningOption(options.metadata, "reasoningEffort") ??
        readReasoningOption(options.metadata, "reasoning_effort");
    if (requested === undefined || requested === false || requested === "off")
        return undefined;
    const level = requested === true ? "high" : requested;
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null)
        return undefined;
    return stringValue(mapped) || level;
}
function readReasoningOption(source, key) {
    if (!source || typeof source !== "object")
        return undefined;
    const value = source[key];
    if (value === true || value === false)
        return value;
    if (typeof value === "string" && REASONING_LEVELS.has(value))
        return value;
    return undefined;
}
export function toWireModelId(model) {
    const value = stringValue(model) || DEFAULT_MODEL;
    return value.startsWith(`${PROVIDER_ID}/`) ? value : `${PROVIDER_ID}/${value}`;
}
export function fromWireModelId(model) {
    const value = String(model || "");
    return value.startsWith(`${PROVIDER_ID}/`) ? value.slice(PROVIDER_ID.length + 1) : value;
}
//# sourceMappingURL=models.js.map