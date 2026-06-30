import os from "node:os";
import path from "node:path";

import type { ClineDeviceAuthorization, Env } from "./types.js";

export function expandHome(input: string, env: Env = process.env): string {
  if (!input) return input;
  if (input === "~") return env.HOME || os.homedir();
  if (input.startsWith("~/")) return path.join(env.HOME || os.homedir(), input.slice(2));
  return input;
}

export function verificationUriWithCode(device: ClineDeviceAuthorization): string {
  if (device.verificationUriComplete) return device.verificationUriComplete;
  try {
    const url = new URL(device.verificationUri);
    url.searchParams.set("user_code", device.userCode);
    return url.toString();
  } catch {
    return device.verificationUri;
  }
}

export function positiveInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

export function optionalNonNegativeInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : undefined;
}

export function withAbortSignal(init: RequestInit, signal?: AbortSignal): RequestInit {
  return signal ? { ...init, signal } : init;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error("Cline login was cancelled.");
}

export async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("Cline login was cancelled."));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
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
