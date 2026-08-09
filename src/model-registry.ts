import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import type { ClinePassModel, ReasoningLevel, SourceReasoningOption } from "./types.js";

export interface CatalogRates {
  input: number;
  output: number;
  cacheRead: number | null;
  cacheWrite: number | null;
}

export interface CatalogPricingTier {
  context: string | null;
  rates: CatalogRates;
}

export interface CatalogModel {
  id: string;
  wireId: string;
  upstreamId: string;
  name: string;
  description: string;
  reasoning: boolean;
  reasoningOptions: SourceReasoningOption[];
  reasoningEfforts: string[];
  input: string[];
  sourceModalities: string[];
  cost: CatalogRates;
  pricingTiers: CatalogPricingTier[];
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

export const CLINE_PASS_CATALOG = loadCatalog();

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
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
  const wireIds = new Set<string>();
  const models: ClinePassModel[] = [];

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
    if (
      !rates ||
      !finiteNonNegative(rates.input) ||
      !finiteNonNegative(rates.output) ||
      !(rates.cacheRead === null || finiteNonNegative(rates.cacheRead)) ||
      !(rates.cacheWrite === null || finiteNonNegative(rates.cacheWrite))
    ) {
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
        ? { thinking: { mode: "effort" as const, efforts: reasoningEfforts } }
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

export function reportRuntimeCatalogIssues(
  issues: readonly string[],
  warn: (message: string) => void = console.warn,
): void {
  for (const issue of issues) warn(`[cline-pass] skipped catalog entry: ${issue}`);
}
