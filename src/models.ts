import { DEFAULT_MODEL, PROVIDER_ID, REASONING_LEVELS } from "./constants.js";
import { buildRuntimeCatalog, reportRuntimeCatalogIssues } from "./model-registry.js";
import type { ClinePassModel, ReasoningLevel, ReasoningOption, RuntimeModel, StreamOptions } from "./types.js";
import { stringValue } from "./utils.js";

const runtimeCatalog = buildRuntimeCatalog();
reportRuntimeCatalogIssues(runtimeCatalog.issues);

export const CLINE_PASS_MODELS: ClinePassModel[] = runtimeCatalog.models;

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
