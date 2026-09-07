import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import {
  PROVIDER_ID,
  UNKNOWN_LIVE_MODEL_CONTEXT_WINDOW,
  UNKNOWN_LIVE_MODEL_MAX_TOKENS,
} from "./constants.js";
import type {
  ClinePassModel,
  ReasoningLevel,
  ReferencePricingTier,
  SourceReasoningOption,
} from "./types.js";

export interface CatalogModel {
  wireId: string;
  upstreamId: string;
  name: string;
  description: string;
  reasoning: boolean;
  reasoningOptions: SourceReasoningOption[];
  sourceModalities: string[];
  pricingTiers: ReferencePricingTier[];
  pricingSource: "cline-docs" | "models.dev-fallback";
  contextWindow: number;
  maxTokens: number;
}

export interface ModelsCatalog {
  schemaVersion: number;
  reviewedAt: string;
  runtimeDefaultModel: string;
  models: CatalogModel[];
}

export interface RuntimeCatalogResult {
  models: ClinePassModel[];
  issues: string[];
}

const OMP_REASONING_LEVELS: ReasoningLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const OMP_REASONING_LEVEL_SET = new Set<ReasoningLevel>(OMP_REASONING_LEVELS);

function loadCatalog(): ModelsCatalog {
  try {
    return JSON.parse(readFileSync(fileURLToPath(new URL("../models.json", import.meta.url)), "utf8")) as ModelsCatalog;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load the committed ClinePass model catalog: ${detail}`);
  }
}

export interface LiveClinePassEntry {
  wireId: string;
  id: string;
  name: string;
  description: string;
}

export const CLINE_PASS_CATALOG = loadCatalog();

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validRates(value: unknown): value is ReferencePricingTier["rates"] {
  if (!value || typeof value !== "object") return false;
  const rates = value as Partial<ReferencePricingTier["rates"]>;
  return finiteNonNegative(rates.input) &&
    finiteNonNegative(rates.output) &&
    (rates.cacheRead === null || finiteNonNegative(rates.cacheRead)) &&
    (rates.cacheWrite === null || finiteNonNegative(rates.cacheWrite));
}

function validPricingTiers(value: unknown): value is ReferencePricingTier[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  let previousCeiling = 0;
  return value.every((tier, index) => {
    if (!validRates(tier?.rates)) return false;
    if (index === value.length - 1) return tier.maxContextTokens === undefined;
    if (!finitePositive(tier.maxContextTokens) || tier.maxContextTokens <= previousCeiling) return false;
    previousCeiling = tier.maxContextTokens;
    return true;
  });
}

function thinkingLevelMap(efforts: readonly string[]): Record<ReasoningLevel, string | null> {
  const advertised = new Set(efforts);
  return Object.fromEntries(
    OMP_REASONING_LEVELS.map(level => {
      if (level === "off") return [level, null];
      if (advertised.has(level)) return [level, level];
      if (level === "xhigh" && advertised.has("max")) return [level, "max"];
      return [level, null];
    }),
  ) as Record<ReasoningLevel, string | null>;
}

function ompReasoningEfforts(efforts: readonly string[]): ReasoningLevel[] {
  return efforts.filter(
    (effort): effort is ReasoningLevel => effort !== "off" && OMP_REASONING_LEVEL_SET.has(effort as ReasoningLevel),
  );
}

export function buildRuntimeCatalog(catalog: ModelsCatalog = CLINE_PASS_CATALOG): RuntimeCatalogResult {
  const issues: string[] = [];
  const ids = new Set<string>();
  const models: ClinePassModel[] = [];
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
    if (!validPricingTiers(pricingTiers)) {
      issues.push(`invalid reference pricing for ${id}`);
      continue;
    }
    if (!finitePositive(model.contextWindow) || !finitePositive(model.maxTokens)) {
      issues.push(`invalid token limits for ${id}`);
      continue;
    }

    const sourceReasoningOptions = Array.isArray(model.reasoningOptions) ? structuredClone(model.reasoningOptions) : [];
    const sourceModalities = Array.isArray(model.sourceModalities) ? [...model.sourceModalities] : ["text"];
    models.push(catalogEntryToRuntimeModel(id, model, pricingTiers, sourceReasoningOptions, sourceModalities));
  }

  return { models, issues };
}

function catalogEntryToRuntimeModel(
  id: string,
  model: CatalogModel,
  pricingTiers: ReferencePricingTier[],
  sourceReasoningOptions: SourceReasoningOption[],
  sourceModalities: string[],
): ClinePassModel {
  const reasoningEfforts = ompReasoningEfforts(
    sourceReasoningOptions.find(option => option.type === "effort")?.values ?? [],
  );
  const rates = pricingTiers[0]!.rates;
  return {
    id,
    wireId: model.wireId,
    name: model.name,
    description: model.description,
    reasoning: model.reasoning === true && reasoningEfforts.length > 0,
    sourceReasoning: model.reasoning === true,
    sourceReasoningOptions,
    thinkingLevelMap: thinkingLevelMap(reasoningEfforts),
    ...(reasoningEfforts.length > 0
      ? { thinking: { mode: "effort" as const, efforts: reasoningEfforts } }
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
  };
}

export function buildUnknownLiveModel(entry: LiveClinePassEntry): ClinePassModel {
  return {
    id: entry.id,
    wireId: entry.wireId,
    name: entry.name || entry.id,
    description: entry.description,
    reasoning: false,
    sourceModalities: ["text"],
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    cacheReadSupported: false,
    cacheWriteSupported: false,
    pricingSource: "conservative-defaults",
    pricingTiers: [{ context: null, rates: { input: 0, output: 0, cacheRead: null, cacheWrite: null } }],
    contextWindow: UNKNOWN_LIVE_MODEL_CONTEXT_WINDOW,
    maxTokens: UNKNOWN_LIVE_MODEL_MAX_TOKENS,
  };
}

export function mergeLiveRosterWithCatalog(
  liveEntries: readonly LiveClinePassEntry[],
  catalog: ModelsCatalog = CLINE_PASS_CATALOG,
): RuntimeCatalogResult {
  const overlay = buildRuntimeCatalog(catalog);
  const overlayByWireId = new Map(overlay.models.map(model => [model.wireId, model]));
  const issues: string[] = [];
  const models: ClinePassModel[] = [];
  const seen = new Set<string>();

  for (const entry of liveEntries) {
    if (!entry?.wireId || !entry.id) {
      issues.push("live roster row is missing a Cline Pass id");
      continue;
    }
    if (seen.has(entry.wireId)) {
      issues.push(`duplicate live model ${entry.wireId}`);
      continue;
    }
    seen.add(entry.wireId);

    const known = overlayByWireId.get(entry.wireId);
    if (known) {
      models.push({
        ...known,
        name: entry.name || known.name,
        ...(entry.description ? { description: entry.description } : {}),
      });
      continue;
    }

    models.push(buildUnknownLiveModel(entry));
  }

  return { models, issues };
}
