import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProviderConfig,
  CLINE_PASS_MODELS,
  fetchDynamicClinePassModels,
  parseRecommendedClinePassRoster,
  RECOMMENDED_MODELS_URL,
  UNKNOWN_LIVE_MODEL_CONTEXT_WINDOW,
  UNKNOWN_LIVE_MODEL_MAX_TOKENS,
} from "../dist/core.js";
import { CLINE_PASS_CATALOG, mergeLiveRosterWithCatalog } from "../dist/model-registry.js";

function liveEntry(model, overrides = {}) {
  return {
    id: model.wireId,
    name: model.name,
    description: model.description,
    ...overrides,
  };
}

function recommendedPayload(clinePass, extras = {}) {
  return {
    clinePass,
    free: [
      { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash (free)", description: "should be ignored" },
    ],
    ...extras,
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

test("parseRecommendedClinePassRoster keeps subscription ids and ignores free plus junk", () => {
  const glm = CLINE_PASS_CATALOG.models.find(model => model.wireId === "cline-pass/glm-5.2");
  const parsed = parseRecommendedClinePassRoster(recommendedPayload([
    liveEntry(glm),
    { id: "not-a-pass-model", name: "Ignored" },
    { name: "missing id" },
    liveEntry(glm),
    "not-an-object",
  ]));

  assert.deepEqual(parsed, [{
    wireId: "cline-pass/glm-5.2",
    id: "glm-5.2",
    name: glm.name,
    description: glm.description,
  }]);
});

test("parseRecommendedClinePassRoster fails closed on a missing subscription bucket", () => {
  assert.throws(() => parseRecommendedClinePassRoster({ free: [] }), /missing clinePass/);
  assert.throws(() => parseRecommendedClinePassRoster({ clinePass: [] }), /no valid clinePass ids/);
  assert.throws(() => parseRecommendedClinePassRoster(null), /must be an object/);
});

test("mergeLiveRosterWithCatalog overlays known metadata and applies conservative defaults", () => {
  const glm = CLINE_PASS_CATALOG.models.find(model => model.wireId === "cline-pass/glm-5.2");
  const kimi = CLINE_PASS_CATALOG.models.find(model => model.wireId === "cline-pass/kimi-k3");
  const merged = mergeLiveRosterWithCatalog([
    { wireId: "cline-pass/brand-new-model", id: "brand-new-model", name: "Brand New", description: "Live only" },
    { wireId: glm.wireId, id: "glm-5.2", name: "GLM 5.2 Live Name", description: "Live description" },
    { wireId: kimi.wireId, id: "kimi-k3", name: kimi.name, description: "" },
    { wireId: glm.wireId, id: "glm-5.2", name: "duplicate", description: "" },
  ]);

  assert.deepEqual(merged.models.map(model => model.id), ["brand-new-model", "glm-5.2", "kimi-k3"]);
  assert.equal(merged.models.some(model => model.id === "qwen3.8-max"), false);
  assert.deepEqual(merged.issues, ["duplicate live model cline-pass/glm-5.2"]);

  const unknown = merged.models[0];
  assert.equal(unknown.name, "Brand New");
  assert.equal(unknown.description, "Live only");
  assert.equal(unknown.reasoning, false);
  assert.deepEqual(unknown.input, ["text"]);
  assert.equal(unknown.contextWindow, UNKNOWN_LIVE_MODEL_CONTEXT_WINDOW);
  assert.equal(unknown.maxTokens, UNKNOWN_LIVE_MODEL_MAX_TOKENS);
  assert.deepEqual(unknown.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  assert.equal(unknown.pricingSource, "conservative-defaults");
  assert.equal(unknown.thinking, undefined);
  assert.equal(unknown.cacheReadSupported, false);

  const liveGlm = merged.models[1];
  const staticGlm = CLINE_PASS_MODELS.find(model => model.id === "glm-5.2");
  assert.equal(liveGlm.name, "GLM 5.2 Live Name");
  assert.equal(liveGlm.description, "Live description");
  assert.equal(liveGlm.contextWindow, staticGlm.contextWindow);
  assert.equal(liveGlm.maxTokens, staticGlm.maxTokens);
  assert.deepEqual(liveGlm.thinking, staticGlm.thinking);
  assert.deepEqual(liveGlm.pricingTiers, staticGlm.pricingTiers);
  assert.equal(liveGlm.pricingSource, staticGlm.pricingSource);

  const liveKimi = merged.models[2];
  const staticKimi = CLINE_PASS_MODELS.find(model => model.id === "kimi-k3");
  assert.equal(liveKimi.name, staticKimi.name);
  assert.equal(liveKimi.thinkingLevelMap.xhigh, "max");
});

test("fetchDynamicClinePassModels uses the public roster URL, mock payload, and no auth header", async () => {
  const glm = CLINE_PASS_CATALOG.models.find(model => model.wireId === "cline-pass/glm-5.2");
  let captured;
  const models = await fetchDynamicClinePassModels({
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return jsonResponse(recommendedPayload([
        liveEntry(glm),
        { id: "cline-pass/brand-new-model", name: "Brand New", description: "Live only" },
      ]));
    },
  });

  assert.equal(captured.url, RECOMMENDED_MODELS_URL);
  assert.equal(captured.init.headers.accept, "application/json");
  assert.equal(captured.init.headers.authorization, undefined);
  assert.equal(captured.init.headers.Authorization, undefined);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.deepEqual(models.map(model => model.id), ["glm-5.2", "brand-new-model"]);
  assert.equal(models[0].maxTokens, CLINE_PASS_MODELS.find(model => model.id === "glm-5.2").maxTokens);
  assert.equal(models[1].pricingSource, "conservative-defaults");
});

test("fetchDynamicClinePassModels fails over to the caller on HTTP and empty roster errors", async () => {
  await assert.rejects(
    fetchDynamicClinePassModels({
      fetchImpl: async () => jsonResponse({ clinePass: [] }, 200),
    }),
    /no valid clinePass ids/,
  );
  await assert.rejects(
    fetchDynamicClinePassModels({
      fetchImpl: async () => jsonResponse({ error: "nope" }, 503),
    }),
    /HTTP 503/,
  );
});

test("buildProviderConfig wires fetchDynamicModels and keeps static models as fallback", async () => {
  const glm = CLINE_PASS_CATALOG.models.find(model => model.wireId === "cline-pass/glm-5.2");
  const config = buildProviderConfig({
    apiKey: "test-token",
    fetchImpl: async () => jsonResponse(recommendedPayload([
      { id: "cline-pass/brand-new-model", name: "Brand New", description: "Live only" },
      liveEntry(glm),
    ])),
  });

  assert.equal(typeof config.fetchDynamicModels, "function");
  assert.equal(config.models, CLINE_PASS_MODELS);
  assert.equal(config.models.length, 12);

  const dynamic = await config.fetchDynamicModels("secret-should-not-be-sent");
  assert.deepEqual(dynamic.map(model => model.id), ["brand-new-model", "glm-5.2"]);
});
