import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
const OMP_REASONING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const OMP_REASONING_LEVEL_SET = new Set(OMP_REASONING_LEVELS);
function loadCatalog() {
    try {
        return JSON.parse(readFileSync(fileURLToPath(new URL("../models.json", import.meta.url)), "utf8"));
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Unable to load the committed ClinePass model catalog: ${detail}`);
    }
}
export const CLINE_PASS_CATALOG = loadCatalog();
function finitePositive(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function finiteNonNegative(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function thinkingLevelMap(efforts) {
    const advertised = new Set(efforts);
    return Object.fromEntries(OMP_REASONING_LEVELS.map(level => {
        if (level === "off")
            return [level, null];
        if (advertised.has(level))
            return [level, level];
        if (level === "xhigh" && advertised.has("max"))
            return [level, "max"];
        return [level, null];
    }));
}
function ompReasoningEfforts(efforts) {
    return efforts.filter((effort) => effort !== "off" && OMP_REASONING_LEVEL_SET.has(effort));
}
export function buildRuntimeCatalog(catalog = CLINE_PASS_CATALOG) {
    const issues = [];
    const ids = new Set();
    const wireIds = new Set();
    const models = [];
    for (const model of catalog.models ?? []) {
        if (!model || typeof model !== "object" || !model.id || !model.wireId) {
            issues.push("catalog row is missing id or wireId");
            continue;
        }
        if (ids.has(model.id) || wireIds.has(model.wireId)) {
            issues.push(`duplicate model selector ${model.id}`);
            continue;
        }
        ids.add(model.id);
        wireIds.add(model.wireId);
        const rates = model.cost;
        if (!rates ||
            !finiteNonNegative(rates.input) ||
            !finiteNonNegative(rates.output) ||
            !(rates.cacheRead === null || finiteNonNegative(rates.cacheRead)) ||
            !(rates.cacheWrite === null || finiteNonNegative(rates.cacheWrite))) {
            issues.push(`invalid reference pricing for ${model.id}`);
            continue;
        }
        if (!finitePositive(model.contextWindow) || !finitePositive(model.maxTokens)) {
            issues.push(`invalid token limits for ${model.id}`);
            continue;
        }
        const reasoningEfforts = ompReasoningEfforts(model.reasoningEfforts ?? []);
        models.push({
            id: model.id,
            wireId: model.wireId,
            name: model.name,
            description: model.description,
            reasoning: model.reasoning === true && reasoningEfforts.length > 0,
            sourceReasoning: model.reasoning === true,
            sourceReasoningOptions: Array.isArray(model.reasoningOptions) ? structuredClone(model.reasoningOptions) : [],
            thinkingLevelMap: thinkingLevelMap(model.reasoningEfforts ?? []),
            ...(reasoningEfforts.length > 0
                ? { thinking: { mode: "effort", efforts: reasoningEfforts } }
                : {}),
            input: Array.isArray(model.input) ? model.input.filter(value => value === "text" || value === "image") : ["text"],
            sourceModalities: Array.isArray(model.sourceModalities) ? [...model.sourceModalities] : ["text"],
            cost: {
                input: rates.input,
                output: rates.output,
                cacheRead: rates.cacheRead ?? 0,
                cacheWrite: rates.cacheWrite ?? 0,
            },
            cacheReadSupported: rates.cacheRead !== null,
            cacheWriteSupported: rates.cacheWrite !== null,
            pricingSource: model.pricingSource,
            contextWindow: model.contextWindow,
            maxTokens: model.maxTokens,
        });
    }
    return { models, issues };
}
export function reportRuntimeCatalogIssues(issues, warn = console.warn) {
    for (const issue of issues)
        warn(`[cline-pass] skipped catalog entry: ${issue}`);
}
//# sourceMappingURL=model-registry.js.map