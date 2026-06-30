import type { JsonRecord } from "./types.js";
export declare function clineHTTPErrorMessage(status: number, body?: JsonRecord): string;
export declare function unwrapClineResponsePayload(payload: unknown): JsonRecord;
export declare function nonSseStreamError(rawBody: string): Error;
