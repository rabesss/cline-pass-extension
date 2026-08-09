const RATE_KEYS = ["input", "output", "cacheRead", "cacheWrite"];
const MAX_SOURCE_RETRY_DELAY_MS = 60_000;

export const RECOMMENDED_MODELS_URL = "https://api.cline.bot/api/v1/ai/cline/recommended-models";
export const CLINE_PASS_DOCS_URL = "https://raw.githubusercontent.com/cline/cline/main/docs/getting-started/clinepass.mdx";
export const MODELS_DEV_URL = "https://models.dev/api.json";

export const EXIT_CODES = Object.freeze({
  CLEAN: 0,
  DRIFT: 1,
  TRANSIENT_FAILURE: 2,
  EXTRACTION_FAILURE: 3,
  USAGE: 64,
});

export class CatalogSourceError extends Error {
  constructor(kind, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CatalogSourceError";
    this.kind = kind;
    this.retryAfterMs = options.retryAfterMs;
  }
}

function extractionFailure(message, cause) {
  return new CatalogSourceError("extraction", message, { cause });
}

function transientFailure(message, cause, retryAfterMs) {
  return new CatalogSourceError("transient", message, { cause, retryAfterMs });
}

function assertExtraction(condition, message) {
  if (!condition) throw extractionFailure(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function finitePositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function requiredString(value, label) {
  assertExtraction(typeof value === "string" && value.trim() !== "", `${label} must be a non-empty string`);
  return value.trim();
}

function nullableRate(value, label) {
  assertExtraction(value === null || finiteNonNegative(value), `${label} must be a non-negative number or null`);
  return value;
}

function normalizeRates(value, label) {
  assertExtraction(isPlainObject(value), `${label} must be an object`);
  for (const key of Object.keys(value)) {
    assertExtraction(RATE_KEYS.includes(key), `${label} has unknown rate field ${key}`);
  }
  assertExtraction(finiteNonNegative(value.input), `${label}.input must be non-negative`);
  assertExtraction(finiteNonNegative(value.output), `${label}.output must be non-negative`);
  return {
    input: value.input,
    output: value.output,
    cacheRead: nullableRate(value.cacheRead ?? null, `${label}.cacheRead`),
    cacheWrite: nullableRate(value.cacheWrite ?? null, `${label}.cacheWrite`),
  };
}

function markdownSection(source, heading, nextHeading) {
  const start = source.indexOf(heading);
  assertExtraction(start >= 0, `ClinePass docs are missing ${heading}`);
  const rest = source.slice(start + heading.length);
  const end = rest.indexOf(nextHeading);
  assertExtraction(end >= 0, `ClinePass docs are missing ${nextHeading}`);
  return rest.slice(0, end);
}

function markdownTableRows(section, expectedColumns, label) {
  const rows = section
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith("|") && line.endsWith("|"))
    .map(line => line.slice(1, -1).split("|").map(cell => cell.trim()));
  assertExtraction(rows.length >= 3, `${label} table is missing or truncated`);
  assertExtraction(rows[0].length === expectedColumns, `${label} header has an unexpected shape`);
  assertExtraction(rows[1].every(cell => /^-+$/.test(cell)), `${label} separator is malformed`);
  for (const [index, row] of rows.slice(2).entries()) {
    assertExtraction(row.length === expectedColumns, `${label} row ${index} has an unexpected shape`);
  }
  return rows.slice(2);
}

function parsePrice(value, label) {
  if (value === "-") return null;
  assertExtraction(/^\$\d+(?:\.\d+)?$/.test(value), `${label} has an invalid price`);
  const parsed = Number(value.slice(1));
  assertExtraction(finiteNonNegative(parsed), `${label} has an invalid numeric price`);
  return parsed;
}

export function extractClinePassDocs(source) {
  assertExtraction(
    typeof source === "string" && source.includes('title: "ClinePass"') && source.includes("## Models"),
    "ClinePass docs marker is missing",
  );
  const modelRows = markdownTableRows(
    markdownSection(source, "## Models", "## Using ClinePass outside of Cline"),
    2,
    "models",
  ).map(([name, rawId], index) => {
    const id = rawId.replace(/^`|`$/g, "");
    assertExtraction(id.startsWith("cline-pass/"), `models row ${index} has an invalid ClinePass id`);
    return { id, name: requiredString(name, `models row ${index}.name`) };
  });

  const seenModelIds = new Set();
  for (const row of modelRows) {
    assertExtraction(!seenModelIds.has(row.id), `duplicate ClinePass docs model id ${row.id}`);
    seenModelIds.add(row.id);
  }

  const pricingById = new Map();
  const priceRows = markdownTableRows(
    markdownSection(source, "## Reference pricing", "## Usage"),
    5,
    "reference pricing",
  );
  for (const [index, row] of priceRows.entries()) {
    const [rawName, input, output, cacheRead, cacheWrite] = row;
    const contextMatch = rawName.match(/\s+\(([^)]+)\)$/);
    const name = contextMatch ? rawName.slice(0, contextMatch.index).trim() : rawName;
    const model = modelRows.find(entry => entry.name === name);
    assertExtraction(model, `reference pricing row ${index} does not match a documented model: ${name}`);
    const tiers = pricingById.get(model.id) ?? [];
    tiers.push({
      context: contextMatch?.[1] ?? null,
      rates: {
        input: parsePrice(input, `${name}.input`),
        output: parsePrice(output, `${name}.output`),
        cacheRead: parsePrice(cacheRead, `${name}.cacheRead`),
        cacheWrite: parsePrice(cacheWrite, `${name}.cacheWrite`),
      },
    });
    pricingById.set(model.id, tiers);
  }

  return {
    models: modelRows.map(model => ({
      ...model,
      pricingTiers: pricingById.get(model.id) ?? [],
    })),
  };
}

export function normalizeRecommendedModels(payload) {
  assertExtraction(isPlainObject(payload), "recommended-models payload must be an object");
  assertExtraction(Array.isArray(payload.clinePass), "recommended-models payload is missing clinePass[]");
  const seen = new Set();
  return payload.clinePass.map((entry, index) => {
    assertExtraction(isPlainObject(entry), `clinePass row ${index} must be an object`);
    const id = requiredString(entry.id, `clinePass row ${index}.id`);
    assertExtraction(id.startsWith("cline-pass/"), `clinePass row ${index}.id must use the cline-pass prefix`);
    assertExtraction(!seen.has(id), `duplicate live ClinePass model id ${id}`);
    seen.add(id);
    return {
      id,
      name: requiredString(entry.name, `clinePass row ${index}.name`),
      description: typeof entry.description === "string" ? entry.description.trim() : "",
    };
  });
}

function modelSlug(id) {
  return id.split("/").at(-1) ?? id;
}

function normalizeModelsDevRates(cost, label) {
  assertExtraction(isPlainObject(cost), `${label}.cost must be an object`);
  assertExtraction(finiteNonNegative(cost.input), `${label}.cost.input must be non-negative`);
  assertExtraction(finiteNonNegative(cost.output), `${label}.cost.output must be non-negative`);
  return {
    input: cost.input,
    output: cost.output,
    cacheRead: finiteNonNegative(cost.cache_read) ? cost.cache_read : null,
    cacheWrite: finiteNonNegative(cost.cache_write) ? cost.cache_write : null,
  };
}

function normalizeReasoningOptions(value, label) {
  assertExtraction(Array.isArray(value), `${label}.reasoning_options must be an array`);
  return value.map((option, index) => {
    const optionLabel = `${label}.reasoning_options[${index}]`;
    assertExtraction(isPlainObject(option), `${optionLabel} must be an object`);
    if (option.type === "toggle") return { type: "toggle" };
    if (option.type === "effort") {
      assertExtraction(Array.isArray(option.values) && option.values.length > 0, `${optionLabel}.values must not be empty`);
      const values = option.values.map((entry, valueIndex) => requiredString(entry, `${optionLabel}.values[${valueIndex}]`));
      assertExtraction(new Set(values).size === values.length, `${optionLabel}.values contains duplicates`);
      return { type: "effort", values };
    }
    if (option.type === "budget_tokens") {
      assertExtraction(finitePositive(option.min), `${optionLabel}.min must be positive`);
      assertExtraction(finitePositive(option.max) && option.max >= option.min, `${optionLabel}.max must be at least min`);
      return { type: "budget_tokens", min: option.min, max: option.max };
    }
    throw extractionFailure(`${optionLabel}.type is unsupported: ${String(option.type)}`);
  });
}

export function normalizeModelsDev(payload, requiredWireIds) {
  const models = payload?.openrouter?.models;
  assertExtraction(isPlainObject(models), "models.dev payload is missing openrouter.models");
  const entriesBySlug = new Map();
  for (const [upstreamId, model] of Object.entries(models)) {
    const slug = modelSlug(upstreamId);
    const matches = entriesBySlug.get(slug) ?? [];
    matches.push([upstreamId, model]);
    entriesBySlug.set(slug, matches);
  }

  return requiredWireIds.map((wireId, index) => {
    const slug = modelSlug(wireId);
    const matches = entriesBySlug.get(slug) ?? [];
    assertExtraction(matches.length === 1, `models.dev expected one openrouter match for ${slug}, found ${matches.length}`);
    const [upstreamId, model] = matches[0];
    assertExtraction(isPlainObject(model), `models.dev row ${index} must be an object`);
    assertExtraction(model.tool_call === true, `models.dev model ${upstreamId} does not advertise tools`);
    assertExtraction(isPlainObject(model.limit), `models.dev model ${upstreamId} is missing limits`);
    assertExtraction(finitePositive(model.limit.context), `models.dev model ${upstreamId} has invalid context limit`);
    assertExtraction(finitePositive(model.limit.output), `models.dev model ${upstreamId} has invalid output limit`);
    assertExtraction(Array.isArray(model.modalities?.input), `models.dev model ${upstreamId} is missing input modalities`);
    const sourceModalities = [...new Set(model.modalities.input.filter(value => typeof value === "string"))];
    assertExtraction(sourceModalities.includes("text"), `models.dev model ${upstreamId} does not advertise text input`);
    const reasoningOptions = normalizeReasoningOptions(model.reasoning_options, `models.dev model ${upstreamId}`);
    const effortOption = reasoningOptions.find(option => option.type === "effort");
    const reasoningEfforts = effortOption
      ? effortOption.values
      : [];

    return {
      slug,
      upstreamId,
      name: requiredString(model.name, `models.dev model ${upstreamId}.name`),
      reasoning: model.reasoning === true,
      reasoningOptions,
      reasoningEfforts,
      sourceModalities,
      contextWindow: model.limit.context,
      maxTokens: Math.floor(model.limit.output),
      rates: normalizeModelsDevRates(model.cost, `models.dev model ${upstreamId}`),
    };
  });
}

export function buildLiveModels(recommended, docs, capabilities) {
  const docsById = new Map(docs.models.map(model => [model.id, model]));
  const capabilitiesBySlug = new Map(capabilities.map(model => [model.slug, model]));
  return recommended.map(entry => {
    const slug = modelSlug(entry.id);
    const capability = capabilitiesBySlug.get(slug);
    assertExtraction(capability, `missing capability row for ${entry.id}`);
    const documented = docsById.get(entry.id);
    const pricingTiers = documented?.pricingTiers?.length
      ? documented.pricingTiers
      : [{ context: null, rates: capability.rates }];
    const input = ["text"];
    if (capability.sourceModalities.includes("image")) input.push("image");
    return {
      id: slug,
      wireId: entry.id,
      upstreamId: capability.upstreamId,
      name: documented?.name ?? capability.name,
      description: entry.description,
      reasoning: capability.reasoning,
      reasoningOptions: capability.reasoningOptions,
      reasoningEfforts: capability.reasoningEfforts,
      input,
      sourceModalities: capability.sourceModalities,
      cost: pricingTiers[0].rates,
      pricingTiers,
      pricingSource: documented?.pricingTiers?.length ? "cline-docs" : "models.dev-fallback",
      contextWindow: capability.contextWindow,
      maxTokens: capability.maxTokens,
    };
  });
}

export function validateCommittedCatalog(catalog) {
  assertExtraction(isPlainObject(catalog), "models.json must be an object");
  assertExtraction(catalog.schemaVersion === 1, "models.json schemaVersion must be 1");
  assertExtraction(Array.isArray(catalog.models), "models.json models must be an array");
  assertExtraction(
    catalog.models.length === catalog.source?.recommendedModels?.expectedCount,
    "committed model count does not match source.recommendedModels.expectedCount",
  );
  const ids = new Set();
  const wireIds = new Set();
  for (const [index, model] of catalog.models.entries()) {
    const label = `models.json model ${index}`;
    assertExtraction(isPlainObject(model), `${label} must be an object`);
    requiredString(model.id, `${label}.id`);
    requiredString(model.wireId, `${label}.wireId`);
    assertExtraction(!ids.has(model.id), `duplicate committed model id ${model.id}`);
    assertExtraction(!wireIds.has(model.wireId), `duplicate committed wire id ${model.wireId}`);
    ids.add(model.id);
    wireIds.add(model.wireId);
    assertExtraction(model.wireId === `cline-pass/${model.id}`, `${label}.wireId does not match id`);
    assertExtraction(Array.isArray(model.input) && model.input.includes("text"), `${label}.input must include text`);
    assertExtraction(Array.isArray(model.sourceModalities), `${label}.sourceModalities must be an array`);
    assertExtraction(typeof model.reasoning === "boolean", `${label}.reasoning must be boolean`);
    const reasoningOptions = normalizeReasoningOptions(model.reasoningOptions, label);
    assertExtraction(Array.isArray(model.reasoningEfforts), `${label}.reasoningEfforts must be an array`);
    const effortOption = reasoningOptions.find(option => option.type === "effort");
    assertExtraction(
      JSON.stringify(model.reasoningEfforts) === JSON.stringify(effortOption?.values ?? []),
      `${label}.reasoningEfforts does not match reasoningOptions`,
    );
    assertExtraction(finitePositive(model.contextWindow), `${label}.contextWindow must be positive`);
    assertExtraction(finitePositive(model.maxTokens), `${label}.maxTokens must be positive`);
    const rates = normalizeRates(model.cost, `${label}.cost`);
    assertExtraction(Array.isArray(model.pricingTiers) && model.pricingTiers.length > 0, `${label}.pricingTiers must not be empty`);
    const firstTier = model.pricingTiers[0];
    assertExtraction(isPlainObject(firstTier), `${label}.pricingTiers[0] must be an object`);
    assertExtraction(
      JSON.stringify(rates) === JSON.stringify(normalizeRates(firstTier.rates, `${label}.pricingTiers[0].rates`)),
      `${label}.cost does not match first-tier pricing`,
    );
    assertExtraction(
      model.pricingSource === "cline-docs" || model.pricingSource === "models.dev-fallback",
      `${label}.pricingSource is invalid`,
    );
  }
  assertExtraction(ids.has(catalog.runtimeDefaultModel), "runtimeDefaultModel is not in the catalog");
  return catalog;
}

function pushDiff(diffs, path, committed, live) {
  if (JSON.stringify(committed) !== JSON.stringify(live)) diffs.push({ path, committed, live });
}

export function compareCatalog(catalog, liveModels, docs) {
  validateCommittedCatalog(catalog);
  const diffs = [];
  pushDiff(diffs, "models", catalog.models, liveModels);
  pushDiff(diffs, "source.recommendedModels.expectedCount", catalog.source.recommendedModels.expectedCount, liveModels.length);
  pushDiff(diffs, "source.clinePassDocs.expectedModelCount", catalog.source.clinePassDocs.expectedModelCount, docs.models.length);
  pushDiff(
    diffs,
    "source.clinePassDocs.expectedPricingModelCount",
    catalog.source.clinePassDocs.expectedPricingModelCount,
    docs.models.filter(model => model.pricingTiers.length > 0).length,
  );
  return diffs;
}

export function buildProposal(catalog, liveModels, docs) {
  return {
    schemaVersion: 1,
    writesPerformed: false,
    diffs: compareCatalog(catalog, liveModels, docs),
  };
}

export function parseRetryAfterMs(value, nowMs = Date.now()) {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : Math.max(0, timestamp - nowMs);
}

function headerValue(headers, name) {
  if (typeof headers?.get === "function") return headers.get(name);
  if (!isPlainObject(headers)) return undefined;
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}

export async function fetchSource(
  url,
  accept,
  {
    fetchImpl = fetch,
    retries = 2,
    delay = ms => new Promise(resolve => setTimeout(resolve, ms)),
    now = () => Date.now(),
  } = {},
) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchImpl(url, {
        headers: { accept, "user-agent": "cline-pass-extension-model-check/1" },
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status >= 300 && response.status < 400) {
        throw extractionFailure(`unexpected redirect from ${url}`);
      }
      if (response.status === 429) {
        throw transientFailure(
          `HTTP 429 from ${url}`,
          undefined,
          parseRetryAfterMs(headerValue(response.headers, "retry-after"), now()),
        );
      }
      if (response.status >= 500) throw transientFailure(`HTTP ${response.status} from ${url}`);
      if (!response.ok) throw extractionFailure(`HTTP ${response.status} from ${url}`);
      const body = await response.text();
      if (!body.trim()) throw extractionFailure(`empty response from ${url}`);
      return body;
    } catch (error) {
      const normalized = error instanceof CatalogSourceError
        ? error
        : transientFailure(`network failure fetching ${url}`, error);
      if (normalized.kind !== "transient" || attempt >= retries) throw normalized;
      const retryDelay = normalized.retryAfterMs ?? 250 * 2 ** attempt;
      if (retryDelay > MAX_SOURCE_RETRY_DELAY_MS) throw normalized;
      await delay(retryDelay);
      lastError = normalized;
    }
  }
  throw lastError ?? transientFailure(`unable to fetch ${url}`);
}

export function exitCodeForError(error) {
  if (error instanceof CatalogSourceError) {
    return error.kind === "transient" ? EXIT_CODES.TRANSIENT_FAILURE : EXIT_CODES.EXTRACTION_FAILURE;
  }
  return EXIT_CODES.EXTRACTION_FAILURE;
}
