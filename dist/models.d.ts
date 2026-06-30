import type { ClinePassModel, RuntimeModel, StreamOptions } from "./types.js";
export declare const CLINE_PASS_MODELS: ClinePassModel[];
export declare function resolveReasoningEffort(model: RuntimeModel | undefined, options: StreamOptions): string | undefined;
export declare function toWireModelId(model: unknown): string;
export declare function fromWireModelId(model: unknown): string;
