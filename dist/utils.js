import os from "node:os";
import path from "node:path";
export function expandHome(input, env = process.env) {
    if (!input)
        return input;
    if (input === "~")
        return env.HOME || os.homedir();
    if (input.startsWith("~/"))
        return path.join(env.HOME || os.homedir(), input.slice(2));
    return input;
}
export function sanitizeErrorDetail(input) {
    return String(input).replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]");
}
export function normalizeBaseUrl(value) {
    return value.replace(/\/+$/, "");
}
export function describeExpiry(value) {
    const timeMs = expiryTimeMs(value);
    if (timeMs === undefined)
        return undefined;
    const expired = timeMs <= Date.now();
    return { expired, detail: expired ? "expired" : "present" };
}
export function isExpired(value, skewMs = 0) {
    const timeMs = expiryTimeMs(value);
    return timeMs !== undefined && timeMs <= Date.now() + skewMs;
}
export function expiryTimeMs(value) {
    if (value === undefined || value === null || value === "")
        return undefined;
    const numeric = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(numeric)) {
        return numeric > 10_000_000_000 ? numeric : numeric * 1000;
    }
    if (typeof value !== "string")
        return undefined;
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? undefined : parsed;
}
export function tokenize(args) {
    const tokens = [];
    let current = "";
    let quote = "";
    let escaping = false;
    for (const char of args) {
        if (escaping) {
            current += char;
            escaping = false;
            continue;
        }
        if (quote) {
            if (char === "\\") {
                escaping = true;
            }
            else if (char === quote) {
                quote = "";
            }
            else {
                current += char;
            }
            continue;
        }
        if (char === "\"" || char === "'") {
            quote = char;
            continue;
        }
        if (/\s/.test(char)) {
            if (current) {
                tokens.push(current);
                current = "";
            }
            continue;
        }
        current += char;
    }
    if (escaping)
        current += "\\";
    if (quote)
        throw new Error("Unclosed quote in arguments");
    if (current)
        tokens.push(current);
    return tokens;
}
export function camelCase(value) {
    return value.replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
}
export function parseBoolean(value, key) {
    if (["1", "true", "yes", "on"].includes(value))
        return true;
    if (["0", "false", "no", "off"].includes(value))
        return false;
    throw new Error(`Invalid boolean for --${key}: ${value}`);
}
export function stringValue(value) {
    return typeof value === "string" && value.trim() ? value.trim() : "";
}
export function numberValue(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
export function safeError(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=utils.js.map