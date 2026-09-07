import { type LiveClinePassEntry, type ModelsCatalog } from "./model-registry.js";
import type { ClinePassModel, FetchLike } from "./types.js";
export interface FetchDynamicModelsOptions {
    fetchImpl?: FetchLike;
    catalog?: ModelsCatalog;
    url?: string;
    timeoutMs?: number;
}
export declare function parseRecommendedClinePassRoster(payload: unknown): LiveClinePassEntry[];
export declare function fetchDynamicClinePassModels(options?: FetchDynamicModelsOptions): Promise<readonly ClinePassModel[]>;
