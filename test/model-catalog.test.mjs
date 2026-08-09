import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildLiveModels,
  buildProposal,
  CatalogSourceError,
  compareCatalog,
  EXIT_CODES,
  exitCodeForError,
  extractClinePassDocs,
  fetchSource,
  normalizeModelsDev,
  normalizeRecommendedModels,
  parseRetryAfterMs,
  validateCommittedCatalog,
} from "../scripts/model-catalog-lib.mjs";

const catalogText = await readFile(new URL("../models.json", import.meta.url), "utf8");
const catalog = JSON.parse(catalogText);

function price(value) {
  return value === null ? "-" : `$${value}`;
}

function docsFixture(sourceCatalog = catalog) {
  const documented = sourceCatalog.models.filter(model => model.pricingSource === "cline-docs");
  const modelRows = documented.map(model => `| ${model.name} | \`${model.wireId}\` |`).join("\n");
  const pricingRows = documented.flatMap(model => model.pricingTiers.map(tier => {
    const label = tier.context ? `${model.name} (${tier.context})` : model.name;
    const rates = tier.rates;
    return `| ${label} | ${price(rates.input)} | ${price(rates.output)} | ${price(rates.cacheRead)} | ${price(rates.cacheWrite)} |`;
  })).join("\n");
  return `---
title: "ClinePass"
---

## Models

| Model | ID |
| --- | --- |
${modelRows}

## Using ClinePass outside of Cline

The API is OpenAI compatible.

## Reference pricing

| Model | Input | Output | Cache read | Cache write |
| --- | --- | --- | --- | --- |
${pricingRows}

## Usage

Usage is subject to subscription limits.
`;
}

function recommendedFixture(sourceCatalog = catalog) {
  return {
    clinePass: sourceCatalog.models.map(model => ({
      id: model.wireId,
      name: model.name,
      description: model.description,
    })),
  };
}

function modelsDevFixture(sourceCatalog = catalog) {
  return {
    openrouter: {
      models: Object.fromEntries(sourceCatalog.models.map(model => {
        const rates = model.pricingTiers[0].rates;
        return [model.upstreamId, {
          name: model.name,
          tool_call: true,
          reasoning: model.reasoning,
          reasoning_options: model.reasoningOptions,
          modalities: { input: model.sourceModalities },
          limit: { context: model.contextWindow, output: model.maxTokens },
          cost: {
            input: rates.input,
            output: rates.output,
            cache_read: rates.cacheRead,
            cache_write: rates.cacheWrite,
          },
        }];
      })),
    },
  };
}

function fixtureSources(sourceCatalog = catalog) {
  const recommended = normalizeRecommendedModels(recommendedFixture(sourceCatalog));
  const docs = extractClinePassDocs(docsFixture(sourceCatalog));
  const capabilities = normalizeModelsDev(
    modelsDevFixture(sourceCatalog),
    recommended.map(model => model.id),
  );
  return { recommended, docs, capabilities };
}

test("catalog source extractors reproduce the committed 12-model snapshot", () => {
  validateCommittedCatalog(catalog);
  const { recommended, docs, capabilities } = fixtureSources();
  const liveModels = buildLiveModels(recommended, docs, capabilities);

  assert.equal(recommended.length, 12);
  assert.equal(docs.models.length, 11);
  assert.equal(capabilities.length, 12);
  assert.deepEqual(liveModels, catalog.models);
  assert.deepEqual(compareCatalog(catalog, liveModels, docs), []);
});

test("catalog proposal is deterministic and never writes models.json", async () => {
  const before = await readFile(new URL("../models.json", import.meta.url), "utf8");
  const { recommended, docs, capabilities } = fixtureSources();
  const liveModels = buildLiveModels(recommended, docs, capabilities);
  const proposal = buildProposal(catalog, liveModels, docs);
  const repeated = buildProposal(catalog, liveModels, docs);
  const after = await readFile(new URL("../models.json", import.meta.url), "utf8");

  assert.deepEqual(proposal, { schemaVersion: 1, writesPerformed: false, diffs: [] });
  assert.deepEqual(repeated, proposal);
  assert.equal(after, before);

  const drifted = structuredClone(liveModels);
  drifted[0].maxTokens -= 1;
  assert.deepEqual(buildProposal(catalog, drifted, docs).diffs.map(diff => diff.path), ["models"]);
});

test("source extraction fails closed on malformed and ambiguous input", () => {
  assert.throws(() => extractClinePassDocs(""), error => error instanceof CatalogSourceError && error.kind === "extraction");
  assert.throws(
    () => extractClinePassDocs(docsFixture().replace("## Usage", "## Missing Usage")),
    /missing ## Usage/,
  );

  const duplicateRecommended = recommendedFixture();
  duplicateRecommended.clinePass.push(structuredClone(duplicateRecommended.clinePass[0]));
  assert.throws(() => normalizeRecommendedModels(duplicateRecommended), /duplicate live ClinePass model id/);

  const duplicateCapabilities = modelsDevFixture();
  duplicateCapabilities.openrouter.models["example/qwen3.8-max"] = structuredClone(
    duplicateCapabilities.openrouter.models["qwen/qwen3.8-max"],
  );
  assert.throws(
    () => normalizeModelsDev(duplicateCapabilities, ["cline-pass/qwen3.8-max"]),
    /expected one openrouter match.*found 2/,
  );

  const missingTools = modelsDevFixture();
  missingTools.openrouter.models["z-ai/glm-5.2"].tool_call = false;
  assert.throws(() => normalizeModelsDev(missingTools, ["cline-pass/glm-5.2"]), /does not advertise tools/);

  const missingPrice = modelsDevFixture();
  delete missingPrice.openrouter.models["qwen/qwen3.8-max"].cost.input;
  assert.throws(() => normalizeModelsDev(missingPrice, ["cline-pass/qwen3.8-max"]), /cost.input must be non-negative/);

  const unknownReasoning = modelsDevFixture();
  unknownReasoning.openrouter.models["z-ai/glm-5.2"].reasoning_options = [{ type: "surprise" }];
  assert.throws(() => normalizeModelsDev(unknownReasoning, ["cline-pass/glm-5.2"]), /type is unsupported/);
});

test("committed validation rejects count, pricing, and selector corruption", () => {
  const badCount = structuredClone(catalog);
  badCount.source.recommendedModels.expectedCount = 11;
  assert.throws(() => validateCommittedCatalog(badCount), /model count/);

  const badPrice = structuredClone(catalog);
  badPrice.models[0].pricingTiers[0].rates.input = -1;
  assert.throws(() => validateCommittedCatalog(badPrice), /pricingTiers\[0\]\.rates\.input/);

  const duplicate = structuredClone(catalog);
  duplicate.models[1].wireId = duplicate.models[0].wireId;
  assert.throws(() => validateCommittedCatalog(duplicate), /duplicate committed model id/);
});

test("source fetching retries bounded transient failures and rejects redirects", async () => {
  let attempts = 0;
  const delays = [];
  const recovered = await fetchSource("https://example.test/models", "application/json", {
    retries: 2,
    delay: async ms => delays.push(ms),
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1
        ? new Response(null, { status: 429, headers: { "retry-after": "0.01" } })
        : new Response("{}", { status: 200 });
    },
  });
  assert.equal(recovered, "{}");
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [10]);

  await assert.rejects(
    fetchSource("https://example.test/models", "application/json", {
      retries: 0,
      fetchImpl: async () => new Response(null, { status: 503 }),
    }),
    error => error instanceof CatalogSourceError && error.kind === "transient",
  );
  await assert.rejects(
    fetchSource("https://example.test/models", "application/json", {
      retries: 0,
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: "/login" } }),
    }),
    error => error instanceof CatalogSourceError && error.kind === "extraction",
  );
  await assert.rejects(
    fetchSource("https://example.test/models", "application/json", {
      retries: 0,
      fetchImpl: async () => new Response("", { status: 200 }),
    }),
    error => error instanceof CatalogSourceError && error.kind === "extraction",
  );

  let cappedAttempts = 0;
  await assert.rejects(
    fetchSource("https://example.test/models", "application/json", {
      retries: 2,
      delay: async () => assert.fail("overlong Retry-After must not sleep"),
      fetchImpl: async () => {
        cappedAttempts += 1;
        return new Response(null, { status: 429, headers: { "retry-after": "120" } });
      },
    }),
    error => error instanceof CatalogSourceError && error.kind === "transient",
  );
  assert.equal(cappedAttempts, 1);

  let bodyAttempts = 0;
  const bodyRecovered = await fetchSource("https://example.test/models", "application/json", {
    retries: 1,
    delay: async () => {},
    fetchImpl: async () => {
      bodyAttempts += 1;
      if (bodyAttempts === 1) {
        return new Response(new ReadableStream({
          start(controller) {
            controller.error(new TypeError("socket reset during body read"));
          },
        }), { status: 200 });
      }
      return new Response("recovered", { status: 200 });
    },
  });
  assert.equal(bodyRecovered, "recovered");
  assert.equal(bodyAttempts, 2);
});

test("Retry-After and error kinds map to stable maintenance outcomes", () => {
  const now = Date.parse("2026-08-09T12:00:00Z");
  assert.equal(parseRetryAfterMs("1.5", now), 1_500);
  assert.equal(parseRetryAfterMs("Sun, 09 Aug 2026 12:00:30 GMT", now), 30_000);
  assert.equal(parseRetryAfterMs("invalid", now), undefined);
  assert.equal(exitCodeForError(new CatalogSourceError("transient", "busy")), EXIT_CODES.TRANSIENT_FAILURE);
  assert.equal(exitCodeForError(new CatalogSourceError("extraction", "shape")), EXIT_CODES.EXTRACTION_FAILURE);
});
