#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import {
  buildLiveModels,
  buildProposal,
  CLINE_PASS_DOCS_URL,
  EXIT_CODES,
  exitCodeForError,
  extractClinePassDocs,
  fetchSource,
  MODELS_DEV_URL,
  normalizeModelsDev,
  normalizeRecommendedModels,
  RECOMMENDED_MODELS_URL,
  validateCommittedCatalog,
} from "./model-catalog-lib.mjs";

async function main(args = process.argv.slice(2)) {
  const proposalOnly = args.includes("--proposal");
  if (args.some(arg => arg !== "--proposal")) {
    console.error("Usage: node scripts/sync-upstream-models.mjs [--proposal]");
    return EXIT_CODES.USAGE;
  }

  const catalog = validateCommittedCatalog(
    JSON.parse(await readFile(new URL("../models.json", import.meta.url), "utf8")),
  );
  const [recommendedSource, docsSource, modelsDevSource] = await Promise.all([
    fetchSource(RECOMMENDED_MODELS_URL, "application/json"),
    fetchSource(CLINE_PASS_DOCS_URL, "text/plain"),
    fetchSource(MODELS_DEV_URL, "application/json"),
  ]);
  const recommended = normalizeRecommendedModels(JSON.parse(recommendedSource));
  const docs = extractClinePassDocs(docsSource);
  const capabilities = normalizeModelsDev(
    JSON.parse(modelsDevSource),
    recommended.map(model => model.id),
  );
  const liveModels = buildLiveModels(recommended, docs, capabilities);
  const proposal = buildProposal(catalog, liveModels, docs);

  if (proposalOnly) {
    console.log(JSON.stringify(proposal, null, 2));
    return proposal.diffs.length === 0 ? EXIT_CODES.CLEAN : EXIT_CODES.DRIFT;
  }

  const liveOnlyPricing = liveModels
    .filter(model => model.pricingSource === "models.dev-fallback")
    .map(model => model.wireId);
  console.log(`ClinePass catalog: ${proposal.diffs.length === 0 ? "clean" : "drift detected"}`);
  console.log(`- live subscription models: ${recommended.length}`);
  console.log(`- documented models: ${docs.models.length}`);
  console.log(`- models.dev capability matches: ${capabilities.length}`);
  console.log(`- live models awaiting Cline pricing docs: ${liveOnlyPricing.join(", ") || "none"}`);
  if (proposal.diffs.length > 0) console.log(JSON.stringify(proposal.diffs, null, 2));
  return proposal.diffs.length === 0 ? EXIT_CODES.CLEAN : EXIT_CODES.DRIFT;
}

try {
  process.exitCode = await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ClinePass catalog check failed: ${message}`);
  process.exitCode = exitCodeForError(error);
}
