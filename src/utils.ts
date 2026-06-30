import os from "node:os";
import path from "node:path";

import type { Env } from "./types.js";

export function expandHome(input: string, env: Env = process.env): string {
  if (!input) return input;
  if (input === "~") return env.HOME || os.homedir();
  if (input.startsWith("~/")) return path.join(env.HOME || os.homedir(), input.slice(2));
  return input;
}

export function sanitizeErrorDetail(input: string): string {
  return String(input).replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]");
}

export function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export function describeExpiry(value: unknown): { expired: boolean; detail: string } | undefined {
  const timeMs = expiryTimeMs(value);
  if (timeMs === undefined) return undefined;
  const expired = timeMs <= Date.now();
  return { expired, detail: expired ? "expired" : "present" };
}

export function isExpired(value: unknown, skewMs = 0): boolean {
  const timeMs = expiryTimeMs(value);
  return timeMs !== undefined && timeMs <= Date.now() + skewMs;
}

export function expiryTimeMs(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  }
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function tokenize(args: string): string[] {
  const tokens: string[] = [];
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
      } else if (char === quote) {
        quote = "";
      } else {
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

  if (escaping) current += "\\";
  if (quote) throw new Error("Unclosed quote in arguments");
  if (current) tokens.push(current);
  return tokens;
}

export function camelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_match, char: string) => char.toUpperCase());
}

export function parseBoolean(value: string, key: string): boolean {
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(`Invalid boolean for --${key}: ${value}`);
}

export function stringValue(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
