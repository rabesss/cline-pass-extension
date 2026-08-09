import type { ClinePassModel, SourceReasoningOption } from "./types.js";
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
export declare const CLINE_PASS_CATALOG: ModelsCatalog;
export declare function buildRuntimeCatalog(catalog?: ModelsCatalog): RuntimeCatalogResult;
export declare function reportRuntimeCatalogIssues(issues: readonly string[], warn?: (message: string) => void): void;
