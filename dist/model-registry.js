import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { PROVIDER_ID } from "./constants.js";
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
function validRates(value) {
    if (!value || typeof value !== "object")
        return false;
    const rates = value;
    return finiteNonNegative(rates.input) &&
        finiteNonNegative(rates.output) &&
        (rates.cacheRead === null || finiteNonNegative(rates.cacheRead)) &&
        (rates.cacheWrite === null || finiteNonNegative(rates.cacheWrite));
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
    const models = [];
    const wirePrefix = `${PROVIDER_ID}/`;
    for (const model of catalog.models ?? []) {
        if (!model || typeof model !== "object" || !model.wireId?.startsWith(wirePrefix)) {
            issues.push("catalog row has an invalid wireId");
            continue;
        }
        const id = model.wireId.slice(wirePrefix.length);
        if (!id || ids.has(id)) {
            issues.push(`duplicate or empty model selector ${id}`);
            continue;
        }
        ids.add(id);
        const pricingTiers = model.pricingTiers;
        if (!Array.isArray(pricingTiers) || pricingTiers.length === 0 || pricingTiers.some(tier => !validRates(tier?.rates))) {
            issues.push(`invalid reference pricing for ${id}`);
            continue;
        }
        if (!finitePositive(model.contextWindow) || !finitePositive(model.maxTokens)) {
            issues.push(`invalid token limits for ${id}`);
            continue;
        }
        const sourceReasoningOptions = Array.isArray(model.reasoningOptions) ? structuredClone(model.reasoningOptions) : [];
        const sourceModalities = Array.isArray(model.sourceModalities) ? [...model.sourceModalities] : ["text"];
        const reasoningEfforts = ompReasoningEfforts(sourceReasoningOptions.find(option => option.type === "effort")?.values ?? []);
        const rates = pricingTiers[0].rates;
        models.push({
            id,
            wireId: model.wireId,
            name: model.name,
            description: model.description,
            reasoning: model.reasoning === true && reasoningEfforts.length > 0,
            sourceReasoning: model.reasoning === true,
            sourceReasoningOptions,
            thinkingLevelMap: thinkingLevelMap(reasoningEfforts),
            ...(reasoningEfforts.length > 0
                ? { thinking: { mode: "effort", efforts: reasoningEfforts } }
                : {}),
            input: sourceModalities.filter(value => value === "text" || value === "image"),
            sourceModalities,
            cost: {
                input: rates.input,
                output: rates.output,
                cacheRead: rates.cacheRead ?? 0,
                cacheWrite: rates.cacheWrite ?? 0,
            },
            cacheReadSupported: rates.cacheRead !== null,
            cacheWriteSupported: rates.cacheWrite !== null,
            pricingSource: model.pricingSource,
            pricingTiers: structuredClone(pricingTiers),
            contextWindow: model.contextWindow,
            maxTokens: model.maxTokens,
        });
    }
    return { models, issues };
}
//# sourceMappingURL=model-registry.js.map