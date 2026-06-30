import type { Env } from "./types.js";
export declare function expandHome(input: string, env?: Env): string;
export declare function sanitizeErrorDetail(input: string): string;
export declare function normalizeBaseUrl(value: string): string;
export declare function describeExpiry(value: unknown): {
    expired: boolean;
    detail: string;
} | undefined;
export declare function isExpired(value: unknown, skewMs?: number): boolean;
export declare function expiryTimeMs(value: unknown): number | undefined;
export declare function tokenize(args: string): string[];
export declare function camelCase(value: string): string;
export declare function parseBoolean(value: string, key: string): boolean;
export declare function stringValue(value: unknown): string;
export declare function numberValue(value: unknown): number;
export declare function safeError(error: unknown): string;
