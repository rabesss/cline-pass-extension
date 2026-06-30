import type { JsonRecord } from "./types.js";
import { sanitizeErrorDetail, stringValue } from "./utils.js";

export function clineHTTPErrorMessage(status: number, body?: JsonRecord): string {
  if (status === 401) return "Cline API returned HTTP 401. Run /login and paste a Cline API key, refresh the Cline app session, or set CLINE_PASS_API_KEY.";
  const detail = stringValue(body?.error) || stringValue(body?.message);
  return detail ? `Cline API returned HTTP ${status}: ${sanitizeErrorDetail(detail)}` : `Cline API returned HTTP ${status}`;
}

export function unwrapClineResponsePayload(payload: unknown): JsonRecord {
  const data = payload && typeof payload === "object" ? payload as JsonRecord : {};
  if (typeof data.success !== "boolean") return data;
  if (!data.success) {
    throw new Error(`Cline API returned an error envelope: ${clineEnvelopeErrorDetail(data)}`);
  }
  const nested = data.data;
  if (!nested || typeof nested !== "object") {
    throw new Error("Cline API returned a success envelope without response data.");
  }
  return nested as JsonRecord;
}

export function nonSseStreamError(rawBody: string): Error {
  try {
    const payload = unwrapClineResponsePayload(JSON.parse(rawBody));
    const objectType = stringValue(payload.object);
    const detail = stringValue(payload.error) || stringValue(payload.message);
    return new Error(objectType
      ? `Cline API returned non-stream ${objectType} JSON while streaming was expected.`
      : detail
        ? `Cline API returned non-SSE JSON while streaming was expected: ${sanitizeErrorDetail(detail)}`
        : "Cline API returned non-SSE JSON while streaming was expected.");
  } catch (error) {
    if (error instanceof SyntaxError) return new Error("Cline API returned a non-SSE streaming response.");
    return error instanceof Error ? error : new Error(String(error));
  }
}

function clineEnvelopeErrorDetail(payload: JsonRecord): string {
  const code = stringValue(payload.code) || stringValue(payload.errorCode) || stringValue(payload.error);
  if (code && /^[A-Za-z0-9_.-]{1,64}$/.test(code)) return code;
  const message = stringValue(payload.message);
  return message ? sanitizeErrorDetail(message) : "unknown_error";
}
