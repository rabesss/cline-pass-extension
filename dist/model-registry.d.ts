import type { ClinePassModel, ReferencePricingTier, SourceReasoningOption } from "./types.js";
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
export declare const CLINE_PASS_CATALOG: ModelsCatalog;
export declare function buildRuntimeCatalog(catalog?: ModelsCatalog): RuntimeCatalogResult;
