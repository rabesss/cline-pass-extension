import { DEFAULT_MODEL, PROVIDER_ID, REASONING_LEVELS } from "./constants.js";
import { buildRuntimeCatalog, reportRuntimeCatalogIssues } from "./model-registry.js";
import { stringValue } from "./utils.js";
const runtimeCatalog = buildRuntimeCatalog();
reportRuntimeCatalogIssues(runtimeCatalog.issues);
export const CLINE_PASS_MODELS = runtimeCatalog.models;
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