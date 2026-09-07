import {
  DYNAMIC_MODEL_FETCH_TIMEOUT_MS,
  PROVIDER_ID,
  RECOMMENDED_MODELS_URL,
} from "./constants.js";
import { mergeLiveRosterWithCatalog, type LiveClinePassEntry, type ModelsCatalog } from "./model-registry.js";
import type { ClinePassModel, FetchLike } from "./types.js";

export interface FetchDynamicModelsOptions {
  fetchImpl?: FetchLike;
  catalog?: ModelsCatalog;
  url?: string;
  timeoutMs?: number;
}

export function parseRecommendedClinePassRoster(payload: unknown): LiveClinePassEntry[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Cline Pass recommended-models payload must be an object");
  }

  const clinePass = (payload as { clinePass?: unknown }).clinePass;
  if (!Array.isArray(clinePass)) {
    throw new Error("Cline Pass recommended-models payload is missing clinePass[]");
  }

  const wirePrefix = `${PROVIDER_ID}/`;
  const entries: LiveClinePassEntry[] = [];
  const seen = new Set<string>();

  for (const row of clinePass) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const rawId = (row as { id?: unknown }).id;
    const wireId = typeof rawId === "string" ? rawId.trim() : "";
    if (!wireId.startsWith(wirePrefix)) continue;
    const id = wireId.slice(wirePrefix.length);
    if (!id || seen.has(wireId)) continue;
    seen.add(wireId);
    const rawName = (row as { name?: unknown }).name;
    const rawDescription = (row as { description?: unknown }).description;
    entries.push({
      wireId,
      id,
      name: typeof rawName === "string" && rawName.trim() ? rawName.trim() : id,
      description: typeof rawDescription === "string" ? rawDescription.trim() : "",
    });
  }

  if (entries.length === 0) {
    throw new Error("Cline Pass recommended-models roster contained no valid clinePass ids");
  }

  return entries;
}

export async function fetchDynamicClinePassModels(
  options: FetchDynamicModelsOptions = {},
): Promise<readonly ClinePassModel[]> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
  if (typeof fetchImpl !== "function") {
    throw new Error("global fetch is not available; use Node 18+ or a runtime with fetch");
  }

  const url = options.url ?? RECOMMENDED_MODELS_URL;
  const timeoutMs = options.timeoutMs ?? DYNAMIC_MODEL_FETCH_TIMEOUT_MS;
  const init: RequestInit = {
    headers: {
      accept: "application/json",
      "user-agent": "cline-pass-extension/dynamic-models",
    },
  };
  if (timeoutMs > 0 && typeof AbortSignal?.timeout === "function") {
    init.signal = AbortSignal.timeout(timeoutMs);
  }

  const response = await fetchImpl(url, init);
  if (!response.ok) {
    throw new Error(`Failed to fetch Cline Pass recommended models: HTTP ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Cline Pass recommended-models response was not valid JSON: ${detail}`);
  }

  const live = parseRecommendedClinePassRoster(payload);
  const merged = options.catalog
    ? mergeLiveRosterWithCatalog(live, options.catalog)
    : mergeLiveRosterWithCatalog(live);
  if (merged.models.length === 0) {
    throw new Error("Cline Pass recommended-models roster produced no usable models");
  }
  return merged.models;
}
